/**
 * groqService.js
 * AI pipeline:
 *   1. transcribe()   — Groq Whisper STT, auto language detection (Hindi + English)
 *   2. chatStream()   — Streaming LLM (OpenAI GPT or Groq LLaMA), yields sentences
 *   3. chat()         — Non-streaming fallback
 *   4. speak()        — TTS → 8 kHz mulaw for Vobiz
 *                       English: Groq Orpheus (canopylabs/orpheus-v1-english)
 *                       Hindi:   OpenAI TTS (tts-1, nova voice)
 *                       NOTE: Groq's PlayAI Hindi TTS was decommissioned Dec 31 2025.
 *                             The replacement on Groq (Orpheus) is English-only.
 *                             We use OpenAI TTS for Hindi — it handles Hinglish well.
 */

import Groq from "groq-sdk";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { mulawChunksToWav16k, wavToMulaw8k } from "./audioUtils.js";
import { searchKnowledge } from "./knowledge.js";

// ─── Singleton clients ────────────────────────────────────────────────────────
let _groq = null;
function groq() {
  if (!_groq) _groq = new Groq({ apiKey: CONFIG.GROQ.API_KEY });
  return _groq;
}

let _openai = null;
function openai() {
  if (!_openai && CONFIG.OPENAI.API_KEY) {
    _openai = new OpenAI({ apiKey: CONFIG.OPENAI.API_KEY });
  }
  return _openai;
}

// ─── ElevenLabs TTS ──────────────────────────────────────────────────────────
// Requests ulaw_8000 output — same format Vobiz expects, zero conversion needed.
// Falls back to OpenAI TTS if ElevenLabs has no credits (402) or key missing.
async function speakElevenLabs(text) {
  const { API_KEY, VOICE_ID, MODEL } = CONFIG.ELEVENLABS;
  if (!API_KEY) return null;

  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=ulaw_8000`,
      {
        method: "POST",
        headers: {
          "xi-api-key":   API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL,
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
        }),
      }
    );

    if (resp.status === 402) {
      log.warn("[TTS/ElevenLabs] 402 Payment Required — add credits at elevenlabs.io/app/subscription/api. Falling back to OpenAI TTS.");
      return null;
    }
    if (!resp.ok) {
      log.warn(`[TTS/ElevenLabs] HTTP ${resp.status} — falling back to OpenAI TTS`);
      return null;
    }

    const arrayBuf = await resp.arrayBuffer();
    const mulawBuf = Buffer.from(arrayBuf);
    log.info(`[TTS] ElevenLabs/Hindi(${VOICE_ID.slice(0, 8)}…) → ${mulawBuf.length} bytes (ulaw_8000)`);
    return mulawBuf;
  } catch (err) {
    log.error("[TTS/ElevenLabs] error:", err.message);
    return null;
  }
}

// No STT prompt — any prompt gets parroted on quiet phone audio.

// Phrases Whisper commonly INVENTS on silence/echo/noise (exact matches only).
const HALLUCINATION_PHRASES = new Set([
  "thank you", "thank you.", "thanks", "thanks.",
  "thank you very much", "thank you very much.",
  "thank you for watching", "thank you for watching.",
  "thanks for watching", "thanks for watching!",
  "please subscribe", "subscribe",
  "you", "you.", "bye", "bye.",
  ".", "..", "...",
  "merci", "merci.", "merci beaucoup",
  "welcome", "welcome.", "you're welcome",
  "see you", "see you.", "see you next time", "see you all.", "okay, see you all.",
  "all in case you", "all in case you...",
  "the caller speaks hindi or english", "the caller speaks hindi or english.",
  "digeesell customer care.", "digeesell customer care",
]);

// Spanish/European fragments Whisper invents when it mis-guesses Hindi 8kHz
// phone audio. These are NEVER real (DigeeSell callers are India/UAE based).
const HALLUCINATION_PATTERNS = [
  /^ahora que/i,
  /^que\s/i,        // Spanish "que ..." — never a real Hindi/English utterance here
  /^y que\b/i,
  /thank you for watching/i,
  /the caller speaks/i,
  /digeesell.*seo.*google ads/i,
  /jak\s*zyj/i,
  /hindi or english conversation/i,   // echo of our own STT prompt on silence
  /^yeah,?\s+good to hear/i,
  /^good to hear you/i,
  /^i'?ll give it a little/i,
  /^i'?m glad to hear/i,
  /^nice to hear from you/i,
];

/** Generic English phrases Whisper invents on silence/noise — only discard when audio is weak. */
const NOISE_PHRASE_PATTERNS = [
  /^hello\.?$/i,
  /^hi\.?$/i,
  /^hey\.?$/i,
  /^yeah,?\s+good to hear/i,
  /^good to hear you/i,
  /^i'?ll give it a little/i,
  /^thank you\.?$/i,
  /^mm-?hmm\.?$/i,
  /^okay\.?$/i,
  /^ok\.?$/i,
];

function isLikelyNoiseHallucination(text, { noSpeechProb = 0, avgLogprob = 0, audioBytes = 0 } = {}) {
  const t = text.trim();
  if (!NOISE_PHRASE_PATTERNS.some((re) => re.test(t))) return false;
  const durationSec = audioBytes / 8000;
  // Real "hello" on a phone call is usually ≥0.7s with decent confidence
  const weakAudio = noSpeechProb > 0.12 || avgLogprob < -0.6 || durationSec < 0.75;
  return weakAudio;
}

export function isHallucination(text) {
  const t = text.trim().toLowerCase();
  if (HALLUCINATION_PHRASES.has(t)) return true;
  if (HALLUCINATION_PATTERNS.some((re) => re.test(text))) return true;
  if (/^(thank you|thanks|see you)\b/i.test(t) && t.length < 30) return true;
  if (/for watching|speaks hindi or english/i.test(t)) return true;
  // Very short Latin-only outputs — almost always noise
  if (t.length <= 2 && !/\p{Script=Devanagari}/u.test(text)) return true;
  return false;
}

/** Fix common phone-mic mis-hearings of hello / short Hindi fillers. */
export function normalizeTranscript(text) {
  const t = text.trim();
  const bare = t.replace(/[?.!।,]/g, "").trim();
  const latinBare = bare
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/^(अलो|अलोग|हेलो|हैलो|दोबरो|नमस्ते|नमस्कार)$/u.test(bare)) return "hello";
  if (/^(hello|hi|hey|namaste|haan|ji|hola)$/i.test(bare)) {
    return bare.toLowerCase() === "namaste" ? "namaste" : "hello";
  }

  // Common Whisper mistakes on Indian 8 kHz phone audio.
  // These are not translations; they recover the caller intent after STT
  // mishears Roman-Hindi sounds as unrelated English/European words.
  if (/^(india|indian)\s+(vat|what|bat|baat)\s+(karogi|krogi|karoge)$/i.test(latinBare)) {
    return "Hindi baat karogi";
  }
  if (/^(hindi|hindī)\s+(vat|what|bat|baat)\s+(karogi|karoge|krogi)$/i.test(latinBare)) {
    return "Hindi baat karogi";
  }
  if (/^hindi\s+(me|mein|main)\s+(baat\s+)?(karo|kero|keroe|kariye|karogi|karoge)/i.test(latinBare)) {
    return "Hindi mein baat karo";
  }
  if (/^jak\s+(zyja|zija|zya)/i.test(latinBare)) {
    return "kya chahiye";
  }
  if (/^(as\s+seal|seal|seo)\s+package/i.test(latinBare)) {
    return "SEO package ke baare mein batao";
  }
  if (/package\s+(given|give|gibbon)\s+in\s+(button|batao|baton)/i.test(latinBare)) {
    return "SEO package ke baare mein batao";
  }
  return t;
}

export function isGreetingOnly(text) {
  return /^(hello|hi|hey|namaste|haan|ji)$/i.test(text.trim().toLowerCase());
}

export function isLanguagePreference(text) {
  return /\b(hindi|हिंदी|हिन्दी|اردو)\b/i.test(text) &&
    /\b(baat|bol|bolo|karo|karogi|karoge|mein|me|main|speak|talk)\b/i.test(text);
}

/** Infer reply language from transcript script, not Whisper's language tag. */
export function inferSpeechLanguage(text) {
  const devanagari = (text.match(/\p{Script=Devanagari}/gu) || []).length;
  const arabic = (text.match(/\p{Script=Arabic}/gu) || []).length; // Urdu script from Whisper
  if (devanagari >= 1) return "hi";
  if (arabic >= 1) return "hi";
  if (/\b(hindi|namaste|baat|karo|karogi|karoge|keroe|kya|kaise|hai|hain|mujhe|chahiye|batao|bataiye|baare|bare|mein|me|main|ji|haan|nahin|nahi)\b/i.test(text)) return "hi";
  return "en";
}

// Languages we genuinely expect from Indian callers.
// Anything outside this set is a Whisper hallucination on noisy/short audio.
const EXPECTED_LANGUAGES = new Set([
  "en", "english",
  "hi", "hindi",
  "ur", "urdu",
  "pa", "punjabi",
  "gu", "gujarati",
  "mr", "marathi",
  "bn", "bengali",
  "ta", "tamil",
  "te", "telugu",
  "kn", "kannada",
  "ml", "malayalam",
  "or", "odia",
]);

// ─── 1. Speech-to-Text ───────────────────────────────────────────────────────
let _debugAudioCounter = 0;

function saveDebugAudio(mulawBuf, wavBuf) {
  if (!CONFIG.GROQ.DEBUG_STT_AUDIO) return;
  try {
    const dir = path.join(process.cwd(), "debug_audio");
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const base = `stt_${ts}_${++_debugAudioCounter}`;
    fs.writeFileSync(path.join(dir, `${base}.mulaw`), mulawBuf);
    fs.writeFileSync(path.join(dir, `${base}.wav`), wavBuf);
    log.info(`[STT/DEBUG] saved debug_audio/${base}.wav (${mulawBuf.length} bytes, ~${(mulawBuf.length / 8000).toFixed(2)}s)`);
  } catch (err) {
    log.warn("[STT/DEBUG] save failed:", err.message);
  }
}

/**
 * Transcribe a mulaw audio Buffer using Groq Whisper.
 * Returns { text: string, language: string }
 */
export async function transcribe(mulawBuf) {
  const audioBytes = mulawBuf?.length || 0;
  const durationSec = (audioBytes / 8000).toFixed(2);

  if (!mulawBuf || audioBytes < 4800) {
    log.info(`[STT] Audio too short (${audioBytes} bytes, ~${durationSec}s) — skipping`);
    return { text: "", language: "en" };
  }

  log.info(`[STT] Input: ${audioBytes} bytes (~${durationSec}s)`);

  const wavBuf = mulawChunksToWav16k([mulawBuf]);
  saveDebugAudio(mulawBuf, wavBuf);
  const audioFile = new File([wavBuf], "audio.wav", { type: "audio/wav" });

  try {
    const pinnedLang = CONFIG.GROQ.STT_LANGUAGE || "";
    const sttParams = {
      file: audioFile,
      model: CONFIG.GROQ.STT_MODEL,
      response_format: "verbose_json",
      temperature: 0,
    };
    // Direct language param forces Whisper decode mode — most reliable on phone audio.
    // When pinned, do NOT send prompt (prompt echoes as fake transcription on silence).
    if (pinnedLang) {
      sttParams.language = pinnedLang;
    } else {
      sttParams.prompt = "Hindi or English conversation.";
    }

    log.info(`[STT] Whisper params: language=${pinnedLang || "auto-detect"} model=${CONFIG.GROQ.STT_MODEL}`);

    const result = await groq().audio.transcriptions.create(sttParams);

    let text = normalizeTranscript(result.text || "");
    const language = (result.language || "en").toLowerCase();

    const segments = result.segments || [];
    const noSpeechProb = segments.length
      ? Math.max(...segments.map((s) => s.no_speech_prob ?? 0))
      : 0;
    const avgLogprob = segments.length
      ? segments.reduce((sum, s) => sum + (s.avg_logprob ?? 0), 0) / segments.length
      : 0;

    if (noSpeechProb > 0.35) {
      log.info(`[STT] no_speech_prob=${noSpeechProb.toFixed(2)} — likely silence/noise, skipping`);
      return { text: "", language: "en" };
    }
    if (avgLogprob < -0.85) {
      log.info(`[STT] avg_logprob=${avgLogprob.toFixed(2)} — low confidence, skipping`);
      return { text: "", language: "en" };
    }

    if (isHallucination(text)) {
      log.info(`[STT] Hallucination pattern (lang=${language}) — discarding: "${text}"`);
      return { text: "", language: "en" };
    }

    if (isLikelyNoiseHallucination(text, { noSpeechProb, avgLogprob, audioBytes })) {
      log.info(
        `[STT] Noise hallucination (no_speech=${noSpeechProb.toFixed(2)} ` +
        `logprob=${avgLogprob.toFixed(2)} dur=${durationSec}s) — discarding: "${text}"`
      );
      return { text: "", language: "en" };
    }

    if (!EXPECTED_LANGUAGES.has(language)) {
      log.warn(`[STT] Unexpected lang "${language}" — trusting text content: "${text}"`);
    }

    if (!text) return { text: "", language: "en" };

    const inferredLang = inferSpeechLanguage(text);
    log.info(
      `[STT] whisper=${language} inferred=${inferredLang} ` +
      `no_speech=${noSpeechProb.toFixed(2)} logprob=${avgLogprob.toFixed(2)} text="${text}"`
    );
    return { text, language: inferredLang };
  } catch (err) {
    log.error("[STT] Groq Whisper error:", err.message);
    return { text: "", language: "en" };
  }
}

// ─── 2. Streaming LLM ────────────────────────────────────────────────────────
/**
 * Async generator — streams LLM tokens and yields complete spoken sentences.
 * Sentence boundaries: . ! ? । followed by whitespace or end-of-stream.
 * Yields each sentence as soon as it's complete so TTS can start immediately.
 */
// True if the string is primarily Devanagari (Hindi) script
function isPrimarilyDevanagari(text) {
  const devanagari = (text.match(/\p{Script=Devanagari}/gu) || []).length;
  return devanagari > text.length * 0.3;
}

export async function* chatStream(userText, conversationHistory = [], language = "en") {
  let kbContext = "";
  try {
    const snippets = await searchKnowledge(userText, 2);
    if (snippets.length) kbContext = snippets.join("\n");
  } catch (_) {}

  const systemPrompt = buildSystemPrompt(language, kbContext);
  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-10),
    { role: "user", content: userText },
  ];

  let buffer = "";
  let streamSrc = null;

  // Try OpenAI streaming first
  const client = openai();
  if (client) {
    try {
      streamSrc = await client.chat.completions.create({
        model: CONFIG.OPENAI.MODEL,
        messages,
        max_tokens: 60,
        temperature: 0.55,
        stream: true,
      });
    } catch (err) {
      log.error("[LLM/OpenAI] stream init error, falling back to Groq:", err.message);
      streamSrc = null;
    }
  }

  // Groq LLaMA streaming fallback
  if (!streamSrc) {
    try {
      streamSrc = await groq().chat.completions.create({
        model: CONFIG.GROQ.LLM_MODEL,
        messages,
        max_tokens: 60,
        temperature: 0.55,
        stream: true,
      });
    } catch (err) {
      log.error("[LLM/Groq] stream init error:", err.message);
      yield "I'm sorry, I had a little trouble there. Could you repeat that?";
      return;
    }
  }

  for await (const chunk of streamSrc) {
    const delta = chunk.choices[0]?.delta?.content || "";
    buffer += delta;

    // Yield every complete sentence as soon as it ends
    let match;
    while ((match = buffer.match(/^([\s\S]+?[.!?।])\s+/)) !== null) {
      const sentence = match[1].trim();
      buffer = buffer.slice(match[0].length);
      if (sentence) {
        log.info(`[LLM-stream] sentence="${sentence}"`);
        yield sentence;
      }
    }
  }

  // Yield any trailing text that didn't end with punctuation
  const remaining = buffer.trim();
  if (remaining) {
    log.info(`[LLM-stream] trailing="${remaining}"`);
    yield remaining;
  }
}

// ─── 3. LLM Response (non-streaming, kept for compatibility) ─────────────────
export async function chat(userText, conversationHistory = [], language = "en") {
  let fullReply = "";
  for await (const sentence of chatStream(userText, conversationHistory, language)) {
    fullReply += (fullReply ? " " : "") + sentence;
  }
  return fullReply || "Could you say that once more, please?";
}

// ─── 4. Text-to-Speech ───────────────────────────────────────────────────────
/**
 * Convert text → 8 kHz mulaw Buffer.
 *
 * English  → Groq Orpheus (canopylabs/orpheus-v1-english)
 *            Fast, crisp, Indian-English accent friendly.
 *
 * Hindi / Hinglish → OpenAI TTS (tts-1, nova voice)
 *            Groq's playai-tts was decommissioned Dec 31 2025. Their only
 *            replacement (Orpheus) is English-only. OpenAI tts-1 handles
 *            Romanised Hindi and Hinglish well and we already have the key.
 *
 * Returns null on failure (caller handles null gracefully).
 */
export async function speak(text, language = "en") {
  if (!text || !text.trim()) return null;

  const isHindi = language === "hi";

  try {
    let wavBuf;

    if (isHindi) {
      // ElevenLabs TTS for Hindi/Hinglish (primary — returns ulaw_8000 directly)
      const elMulaw = await speakElevenLabs(text);
      if (elMulaw) return elMulaw;  // already mulaw, skip WAV conversion below

      // Fallback: OpenAI TTS (when ElevenLabs has no credits or key missing)
      const client = openai();
      if (!client) {
        log.warn("[TTS] No OpenAI key — cannot speak Hindi. Set OPENAI_API_KEY.");
        return null;
      }
      const response = await client.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        input: text,
        response_format: "wav",
      });
      wavBuf = Buffer.from(await response.arrayBuffer());
      log.info(`[TTS] OpenAI/Hindi(nova) fallback → for "${text.slice(0, 60)}"`);
    } else {
      // Groq Orpheus for English
      const response = await groq().audio.speech.create({
        model: CONFIG.GROQ.TTS_MODEL,
        voice: CONFIG.GROQ.TTS_VOICE,
        input: text,
        response_format: "wav",
        // NOTE: do NOT pass sample_rate — Groq only rewrites the WAV header,
        // it does NOT actually resample. wavToMulaw8k() resamples correctly.
      });
      wavBuf = Buffer.from(await response.arrayBuffer());
      log.info(`[TTS] Orpheus/EN → for "${text.slice(0, 60)}"`);
    }

    const mulawBuf = wavToMulaw8k(wavBuf);
    log.info(`[TTS] → ${mulawBuf.length} bytes`);
    return mulawBuf;
  } catch (err) {
    log.error("[TTS] error:", err.message);
    return null;
  }
}

// ─── System Prompt ────────────────────────────────────────────────────────────
export function buildSystemPrompt(language = "en", kbContext = "") {
  const speakHindi = language === "hi";
  const agent   = CONFIG.AGENT_NAME   || "Riya";
  const company = CONFIG.COMPANY_NAME || "DigeeSell";

  const langInstruction = speakHindi
    ? `LANGUAGE: The caller is speaking Hindi. Reply ONLY in Romanised Hindi/Hinglish using English letters. Do NOT write Devanagari. Do NOT write Urdu/Arabic script. Keep it to one short spoken sentence unless absolutely needed. Example: "Bilkul, main aapki madad karungi."`
    : `LANGUAGE: Reply in clear, fluent, natural English. Do NOT randomly add Hindi phrases. Do NOT switch language based on short filler words like "Mm-hmm", "OK", "Hello". Speak like a warm Indian customer-care executive.`;

  const corePrompt = `You are ${agent}, a friendly customer-care executive at ${company} — a leading digital marketing agency in India. You are a real person on a phone call, NOT a bot.

WHO YOU ARE:
- You are ${agent} from the ${company} customer-care team. Speak naturally, warmly, like a real human agent.
- NEVER say you are an AI, a bot, an assistant, a language model, or "virtual". If asked "are you a robot/AI?", lightly reassure: "I'm ${agent} from ${company} customer care — here to help you personally. What can I do for you?"

PERSONALITY & TONE:
- Warm, confident, and genuinely helpful — like the best human support rep
- Keep EVERY reply to 1 short spoken sentence whenever possible — this is a live phone call, not an email
- No bullet points, lists, or markdown — only natural spoken language
- Never say "I don't have that information" — give something useful or offer a callback from a specialist

${langInstruction}

BEHAVIOUR:
- Use the KNOWLEDGE BASE below as your source of truth for services, pricing, and details. Prefer it over guessing.
- After answering, briefly invite the next question — e.g. "Is there anything else I can help you with?"
- For very specific pricing, timelines, or custom requirements: "I can have one of our specialists call you back with exact details — would that work?"
- If the caller says only "hello", "hi", or "namaste": reply in ONE short line only — e.g. "Ji, boliye — main sun rahi hoon." or "Yes, go ahead — how can I help?" NEVER repeat your full introduction again.
- If the caller says something short/unclear ("Mm-hmm", "OK"): acknowledge in one short line and wait.
- Never end the call yourself — always leave it open for the caller.

ABOUT ${company}:
${company} is a full-service digital marketing agency based in India, serving startups, SMEs, and enterprise brands across India and internationally.
Services: SEO & content marketing, social media management (Instagram, Facebook, LinkedIn, YouTube), Google Ads & Meta Ads, website design & development, WhatsApp marketing automation, email marketing, online reputation management, e-commerce (Shopify, WooCommerce), brand identity & logo design, video production, and influencer marketing.
Approach: data-driven strategies, transparent reporting, and a dedicated account manager for every client.
Industries: fashion, food & beverage, real estate, healthcare, education, retail, and tech.
Onboarding: starts with a free strategy call. Clients can reach us via website, WhatsApp, or phone.`;

  const kbSection = kbContext
    ? `\n\nKNOWLEDGE BASE (your source of truth — use it to answer accurately):\n${kbContext}`
    : "";

  return corePrompt + kbSection;
}
