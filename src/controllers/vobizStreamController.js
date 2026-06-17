/**
 * vobizStreamController.js
 * Handles Vobiz bidirectional Media Streams over WebSocket.
 *
 * ── Three bugs fixed here ─────────────────────────────────────────────────────
 *
 * 1. ECHO HANGUP: The agent's own TTS audio was looping back through the phone
 *    mic. Whisper heard "Thank you for calling DigeeSell" and the farewell regex
 *    matched "thank you" → instant goodbye. Fixed with:
 *      a) Echo guard: ignore any utterance that ends while agent is speaking or
 *         within ECHO_GUARD_MS after it stops (the echo tail).
 *      b) Greeting lock: don't process ANY caller speech until the greeting
 *         finishes playing (playedStream ack). The echo of the greeting itself
 *         cannot trigger processing.
 *
 * 2. FAREWELL REGEX: "thank you" and "thanks" were in the goodbye list. These
 *    are common conversational phrases, not call-enders. Removed. Farewell now
 *    only triggers on unambiguous goodbye words.
 *
 * 3. BARGE-IN BUFFER: When barge-in fires (caller speaks during agent audio),
 *    we now reset the VAD's speech buffer so the echo that *triggered* barge-in
 *    is discarded and only fresh post-barge-in audio reaches Whisper.
 *
 * ── Vobiz WebSocket protocol ──────────────────────────────────────────────────
 *   Vobiz → Server:  start | media | (WS close = call ended)
 *   Server → Vobiz:  playAudio | clearAudio | checkpoint | stop
 */

import fs   from "fs";
import path from "path";
import { VadDetector } from "../services/vadService.js";
import {
  transcribe, chat, speak, inferSpeechLanguage,
  isGreetingOnly, isLanguagePreference,
} from "../services/groqService.js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

function buildGreeting() {
  const name = CONFIG.AGENT_NAME || "Riya";
  if (CONFIG.GREETING_MODE === "full") {
    return `Hello, thank you for calling ${CONFIG.COMPANY_NAME}! My name is ${name} from customer care. How may I help you today?`;
  }
  return `Hello, I am ${name}.`;
}

const GREETING = buildGreeting();

// Echo tail after agent stops — keep short so caller isn't blocked from speaking.
const ECHO_GUARD_MS = 450;

// ─── Active call registry ─────────────────────────────────────────────────────
const activeCalls = new Map();
let _utteranceCounter = 0;

// ─── WebSocket connection handler ─────────────────────────────────────────────
export function handleVobizStream(ws) {
  log.info("[vobiz-stream] WebSocket connection opened");

  const s = {
    ws,
    callId:             null,
    streamId:           null,
    language:           "en",   // confirmed language
    hindiTurnCount:     0,      // Hindi turns before confirming switch
    conversation:       [],     // { role, content } for LLM context
    transcript:         [],     // saved { role, text, ts }
    isAgentSpeaking:    false,
    isBusy:             false,
    pendingUtterance:   null,   // queue one utterance if pipeline was busy
    bargedIn:           false,
    greetingPlayed:     false,  // unlocked after greeting finishes on caller's phone
    greetingFallbackTimer: null,
    agentLastStoppedAt: 0,
    vad:                null,
  };

  // ── VAD — barge-in + utterance detection ───────────────────────────────────
  s.vad = new VadDetector({
    onSpeechStart: () => {
      // NEVER barge-in during the greeting — line noise was triggering clearAudio
      // and wiping TTS before the caller could hear anything.
      if (!s.greetingPlayed) return;

      if (s.isAgentSpeaking) {
        log.info("[vad] Barge-in — flushing Vobiz audio + resetting VAD buffer");
        s.bargedIn = true;   // tells streaming pipeline to stop after current sentence
        _clearAudio(s);
        s.vad.resetSpeechBuffer();
      }
    },
    onSpeechEnd: (audioBuf) => {
      // Don't process anything until the greeting has fully played on the caller's
      // end. This prevents the greeting's own echo from being transcribed.
      if (!s.greetingPlayed) {
        log.info("[vad] Greeting not yet complete — ignoring utterance");
        return;
      }

      // Echo guard: utterances that end while the agent is speaking OR within
      // ECHO_GUARD_MS of the agent stopping are phone mic echo, not real speech.
      const msSinceAgentStopped = Date.now() - s.agentLastStoppedAt;
      if (s.isAgentSpeaking || msSinceAgentStopped < ECHO_GUARD_MS) {
        log.info(`[vad] Echo guard — dropping utterance (agentSpeaking=${s.isAgentSpeaking}, msSinceStopped=${msSinceAgentStopped})`);
        return;
      }

      if (s.isBusy) {
        s.pendingUtterance = audioBuf;
        log.info("[vad] Pipeline busy — queued latest utterance");
        return;
      }

      _handleSpeech(s, audioBuf).catch((err) =>
        log.error("[vobiz-stream] handleSpeech error:", err.message)
      );
    },
  });

  // ── WebSocket message handler ──────────────────────────────────────────────
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.event) {

      case "start": {
        const { callId, streamId, mediaFormat, accountId } = msg.start || {};
        s.callId   = callId   || "unknown";
        s.streamId = streamId || "unknown";
        log.info(
          `[vobiz-stream] START callId=${s.callId} streamId=${s.streamId} ` +
          `format=${JSON.stringify(mediaFormat)} accountId=${accountId}`
        );
        activeCalls.set(s.streamId, s);

        // Play greeting after a short pause (Vobiz needs ~300 ms to settle)
        setTimeout(async () => {
          const bytes = await _sendSpeech(s, GREETING, true);
          s.transcript.push({ role: "digee", text: GREETING, ts: _now() });

          // If Vobiz never sends playedStream (e.g. clearAudio interrupted), unlock
          // after the greeting should have finished playing so the call isn't stuck silent.
          const playMs = bytes ? Math.ceil((bytes / 8000) * 1000) + 800 : 8000;
          s.greetingFallbackTimer = setTimeout(() => _unlockGreeting(s, "fallback-timer"), playMs);
        }, 350);
        break;
      }

      case "media": {
        if (!msg.media?.payload) break;

        // Ignore inbound audio until greeting has played — prevents line noise
        // from triggering barge-in/clearAudio and killing the greeting TTS.
        if (!s.greetingPlayed) break;

        // HALF-DUPLEX ECHO SUPPRESSION (the key listening fix):
        // While the agent is speaking — and during the echo tail right after it
        // stops — do NOT feed caller audio into the VAD. The phone speaker plays
        // the agent's TTS, the phone mic picks it up, and Whisper was transcribing
        // that echo ("How are you?", "Are you all right?") and replying to itself.
        // By staying deaf while we talk, only the caller's real speech is heard.
        const msSinceAgentStopped = Date.now() - s.agentLastStoppedAt;
        if (s.isAgentSpeaking || msSinceAgentStopped < ECHO_GUARD_MS) {
          // Drop any half-captured echo so it can't bleed into the next utterance.
          if (s.vad.isSpeaking) s.vad.reset();
          break;
        }

        s.vad.feed(Buffer.from(msg.media.payload, "base64"));
        break;
      }

      // Vobiz ack: the audio up to this checkpoint finished playing on caller end
      case "playedStream":
        s.isAgentSpeaking    = false;
        s.agentLastStoppedAt = Date.now();

        if (!s.greetingPlayed) {
          _unlockGreeting(s, "playedStream");
        } else {
          log.info(`[vobiz-stream] playedStream ack (name=${msg.name})`);
        }
        break;

      case "clearedAudio":
        log.info("[vobiz-stream] clearedAudio ack");
        break;

      default:
        if (msg.event) log.info(`[vobiz-stream] unknown event: ${msg.event}`);
    }
  });

  ws.on("close", (code, reason) => {
    log.info(`[vobiz-stream] closed code=${code} reason=${reason || "none"}`);
    _saveTranscript(s);
    _cleanup(s);
  });

  ws.on("error", (err) => {
    log.error("[vobiz-stream] error:", err.message);
    _cleanup(s);
  });
}

// ─── Speech pipeline: STT → LLM → single TTS (faster on phone) ───────────────
async function _handleSpeech(s, audioBuf) {
  s.isBusy    = true;
  s.bargedIn  = false;
  try {
    if (s.ws.readyState !== 1) return;

    const { text, language } = await transcribe(audioBuf);
    if (!text || text.trim().length < 2) {
      log.info("[pipeline] Empty transcription — skipping");
      return;
    }
    log.info(`[pipeline] caller (${language}): "${text}"`);

    const scriptLang = inferSpeechLanguage(text);
    if (scriptLang === "hi") {
      s.hindiTurnCount++;
      s.language = "hi";
    } else if (text.trim().split(/\s+/).length >= 2) {
      s.hindiTurnCount = 0;
      s.language = "en";
    }

    s.transcript.push({ role: "caller", text, lang: language, ts: _now() });

    if (_isFarewell(text)) {
      const bye = s.language === "hi"
        ? "Shukriya call karne ke liye! Aapka din bahut accha rahe."
        : "Thank you for calling DigeeSell! Have a wonderful day. Goodbye!";
      await _sendSpeech(s, bye);
      s.transcript.push({ role: "digee", text: bye, ts: _now() });
      setTimeout(() => _endStream(s), 4000);
      return;
    }

    // Fast path: hello/hi/namaste — no LLM, no repeated intro
    if (isGreetingOnly(text)) {
      const reply = s.language === "hi"
        ? "Ji, boliye — main sun rahi hoon."
        : "Yes, go ahead — how can I help?";
      await _sendSpeech(s, reply);
      s.transcript.push({ role: "digee", text: reply, ts: _now() });
      s.conversation.push({ role: "user",      content: text  });
      s.conversation.push({ role: "assistant", content: reply });
      return;
    }

    // Fast path: caller asks to speak in Hindi — no KB/LLM delay.
    if (isLanguagePreference(text)) {
      s.language = "hi";
      const reply = "Bilkul, Hindi mein baat karte hain. Aap bataiye.";
      await _sendSpeech(s, reply);
      s.transcript.push({ role: "digee", text: reply, ts: _now() });
      s.conversation.push({ role: "user",      content: text  });
      s.conversation.push({ role: "assistant", content: reply });
      return;
    }

    // One LLM call + one TTS call per turn = lower latency on Vobiz
    const fullReply = await chat(text, s.conversation, s.language);
    if (!fullReply || s.bargedIn || s.ws.readyState !== 1) return;

    log.info(`[pipeline] Digee: "${fullReply}"`);
    await _sendSpeech(s, fullReply);
    s.conversation.push({ role: "user",      content: text      });
    s.conversation.push({ role: "assistant", content: fullReply });
    s.transcript.push({ role: "digee", text: fullReply, ts: _now() });

  } finally {
    s.isBusy   = false;
    s.bargedIn = false;
    if (s.pendingUtterance) {
      const next = s.pendingUtterance;
      s.pendingUtterance = null;
      _handleSpeech(s, next).catch((err) =>
        log.error("[vobiz-stream] queued handleSpeech error:", err.message)
      );
    }
  }
}

// ─── TTS → stream audio chunks to Vobiz ──────────────────────────────────────
// Returns mulaw byte count sent (for greeting fallback timing), or 0 on failure.
async function _sendSpeech(s, text, isGreeting = false) {
  if (s.ws.readyState !== 1) return 0;

  const mulawBuf = await speak(text, isGreeting ? "en" : s.language);
  if (!mulawBuf) {
    log.warn("[tts] speak() returned null — skipping");
    return 0;
  }

  s.isAgentSpeaking = true;
  const uttName = `utt-${++_utteranceCounter}`;

  const CHUNK = 4000;
  for (let offset = 0; offset < mulawBuf.length; offset += CHUNK) {
    if (!s.isAgentSpeaking) {
      log.info("[tts] Barge-in mid-stream — stopping TTS send");
      return offset;
    }
    if (s.ws.readyState !== 1) return offset;

    s.ws.send(JSON.stringify({
      event: "playAudio",
      media: {
        contentType: "audio/x-mulaw",
        sampleRate:  8000,
        payload:     mulawBuf.subarray(offset, offset + CHUNK).toString("base64"),
      },
    }));
    await _sleep(0);
  }

  if (s.ws.readyState === 1 && s.streamId) {
    s.ws.send(JSON.stringify({ event: "checkpoint", streamId: s.streamId, name: uttName }));
  }

  return mulawBuf.length;
}

// ─── Barge-in: flush Vobiz queue + mark agent stopped ─────────────────────────
function _clearAudio(s) {
  if (!s.greetingPlayed) return; // never flush during greeting
  s.isAgentSpeaking    = false;
  s.agentLastStoppedAt = Date.now();
  if (s.ws.readyState === 1 && s.streamId) {
    s.ws.send(JSON.stringify({ event: "clearAudio", streamId: s.streamId }));
  }
}

function _unlockGreeting(s, reason) {
  if (s.greetingPlayed) return;
  if (s.greetingFallbackTimer) {
    clearTimeout(s.greetingFallbackTimer);
    s.greetingFallbackTimer = null;
  }
  s.greetingPlayed     = true;
  s.isAgentSpeaking    = false;
  s.agentLastStoppedAt = Date.now();
  s.vad?.reset();
  log.info(`[vobiz-stream] Greeting done (${reason}) — now listening for caller`);
}

// ─── Server-initiated hangup ──────────────────────────────────────────────────
function _endStream(s) {
  if (s.ws.readyState === 1 && s.streamId) {
    s.ws.send(JSON.stringify({ event: "stop", streamId: s.streamId }));
  }
  try { s.ws.close(); } catch (_) {}
}

// ─── Farewell detection ───────────────────────────────────────────────────────
// Only clear, unambiguous goodbye words. "thank you" and "thanks" are removed
// because they appear in the greeting and are common mid-conversation phrases.
function _isFarewell(text) {
  return /\b(bye|goodbye|good\s*bye|good\s*night|hang\s*up|end\s*(the\s*)?call|alvida|shukriya|dhanyawad|bas\s*karo|call\s*band\s*karo)\b/i.test(text);
}

// ─── Transcript ───────────────────────────────────────────────────────────────
function _saveTranscript(s) {
  if (!s.transcript.length) return;
  try {
    const dir  = path.join(process.cwd(), "transcripts");
    fs.mkdirSync(dir, { recursive: true });
    const ts   = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `transcript_${ts}_${s.callId}`;

    fs.writeFileSync(
      path.join(dir, `${base}.json`),
      JSON.stringify({ callId: s.callId, language: s.language, turns: s.transcript }, null, 2)
    );
    fs.writeFileSync(
      path.join(dir, `${base}.txt`),
      s.transcript
        .map((t) => `[${t.ts}] ${t.role === "caller" ? "CALLER" : "DIGEE"}: ${t.text}`)
        .join("\n")
    );
    log.info(`[transcript] saved → ${base}.txt`);
  } catch (err) {
    log.error("[transcript] save error:", err.message);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
function _cleanup(s) {
  if (s.greetingFallbackTimer) clearTimeout(s.greetingFallbackTimer);
  if (s.streamId) activeCalls.delete(s.streamId);
  s.vad?.reset();
}

function _now()     { return new Date().toISOString(); }
function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
