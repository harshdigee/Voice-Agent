/**
 * groqService.js
 * AI pipeline:
 *   1. transcribe()   — Groq Whisper STT, auto language detection (Hindi + English)
 *   2. chat()         — OpenAI GPT (if OPENAI_API_KEY set) or Groq LLaMA as fallback
 *   3. speak()        — Groq Orpheus TTS → 8 kHz mulaw for Vobiz
 */

import Groq from "groq-sdk";
import OpenAI from "openai";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { mulawChunksToWav, wavToMulaw8k } from "./audioUtils.js";
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

// ─── 1. Speech-to-Text ───────────────────────────────────────────────────────
/**
 * Transcribe a mulaw audio Buffer using Groq Whisper.
 * Returns { text: string, language: string }
 */
export async function transcribe(mulawBuf) {
  if (!mulawBuf || mulawBuf.length < 320) {
    // Too short to be meaningful speech (<40 ms)
    return { text: "", language: "en" };
  }

  const wavBuf = mulawChunksToWav([mulawBuf]);

  // Groq SDK expects an uploadable — use a Blob wrapped in a File
  const audioFile = new File([wavBuf], "audio.wav", { type: "audio/wav" });

  try {
    const result = await groq().audio.transcriptions.create({
      file: audioFile,
      model: CONFIG.GROQ.STT_MODEL,
      response_format: "verbose_json",
      // language omitted → Whisper auto-detects (Hindi / English / etc.)
    });

    const text = (result.text || "").trim();
    const language = result.language || "en";
    log.info(`[STT] lang=${language} text="${text}"`);
    return { text, language };
  } catch (err) {
    log.error("[STT] Groq Whisper error:", err.message);
    return { text: "", language: "en" };
  }
}

// ─── 2. LLM Response ─────────────────────────────────────────────────────────
/**
 * Generate Digee's next response.
 *
 * @param {string} userText          - What the caller just said
 * @param {Array}  conversationHistory - Prior { role, content } pairs
 * @param {string} language          - Detected language code ("hi", "en", …)
 * @returns {Promise<string>}
 */
export async function chat(userText, conversationHistory = [], language = "en") {
  // Try to pull relevant KB context (non-blocking — fail gracefully)
  let kbContext = "";
  try {
    const snippets = await searchKnowledge(userText, 2);
    if (snippets.length) kbContext = snippets.join("\n");
  } catch (_) {}

  const systemPrompt = buildSystemPrompt(language, kbContext);

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-10), // last 5 user+assistant turns
    { role: "user", content: userText },
  ];

  // Use OpenAI if key is configured, else fall back to Groq LLaMA
  const client = openai();
  if (client) {
    try {
      const completion = await client.chat.completions.create({
        model: CONFIG.OPENAI.MODEL,
        messages,
        max_tokens: 160,
        temperature: 0.65,
      });
      const reply = completion.choices[0]?.message?.content?.trim() || "";
      log.info(`[LLM/OpenAI] response="${reply}"`);
      return reply || "Could you say that once more, please?";
    } catch (err) {
      log.error("[LLM/OpenAI] error, trying Groq fallback:", err.message);
    }
  }

  // Groq LLaMA fallback
  try {
    const completion = await groq().chat.completions.create({
      model: CONFIG.GROQ.LLM_MODEL,
      messages,
      max_tokens: 160,
      temperature: 0.65,
    });
    const reply = completion.choices[0]?.message?.content?.trim() || "";
    log.info(`[LLM/Groq] response="${reply}"`);
    return reply || "Could you say that once more, please?";
  } catch (err) {
    log.error("[LLM/Groq] error:", err.message);
    return "I'm sorry, I had a little trouble there. Could you repeat that?";
  }
}

// ─── 3. Text-to-Speech ───────────────────────────────────────────────────────
/**
 * Convert text → 8 kHz mulaw Buffer using Groq PlayAI TTS.
 * Returns null on failure (caller should handle gracefully).
 */
export async function speak(text, language = "en") {
  if (!text || !text.trim()) return null;

  // Choose voice — Arya-PlayAI handles Indian-accented English & Hinglish well
  const voice = CONFIG.GROQ.TTS_VOICE;

  try {
    const response = await groq().audio.speech.create({
      model: CONFIG.GROQ.TTS_MODEL,
      voice,
      input: text,
      response_format: "wav",   // Orpheus only supports wav (always 24 kHz PCM)
      // NOTE: do NOT pass sample_rate — Groq only rewrites the WAV header value,
      // it does NOT actually resample. The real audio is always 24 kHz, and
      // wavToMulaw8k() resamples 24 kHz → 8 kHz correctly using the true header.
    });

    const wavBuf = Buffer.from(await response.arrayBuffer());
    const mulawBuf = wavToMulaw8k(wavBuf);
    log.info(`[TTS] generated ${mulawBuf.length} mulaw bytes for "${text.slice(0, 60)}"`);
    return mulawBuf;
  } catch (err) {
    log.error("[TTS] Groq PlayAI error:", err.message);
    return null;
  }
}

// ─── System Prompt ────────────────────────────────────────────────────────────
export function buildSystemPrompt(language = "en", kbContext = "") {
  const speakHindi = language === "hi";

  const langInstruction = speakHindi
    ? `LANGUAGE: The caller is speaking Hindi. Reply in clear, conversational Romanised Hindi (e.g. "Bilkul, hum aapki poori madad karenge!"). You may naturally mix a few English words for technical terms — that is normal.`
    : `LANGUAGE: Always reply in clear, fluent English. Do NOT randomly add Hindi phrases. Do NOT switch to Hindi based on short filler words like "Mm-hmm", "OK", "Hello", or foreign words. Speak naturally like a professional Indian customer support agent speaking English.`;

  const corePrompt = `You are Digee, the AI voice assistant for DigeeSell — India's premier digital marketing agency.

PERSONALITY & TONE:
- Sound like a warm, confident, professional human — never robotic or stiff
- Be friendly, direct, and genuinely helpful
- Keep EVERY response to 1–2 short spoken sentences — this is a phone call, not an email
- Never use bullet points, lists, or markdown formatting — only natural spoken language
- Never say "I don't have that information" — always give something useful or offer to connect them

${langInstruction}

BEHAVIOUR:
- After answering, briefly invite the next question — e.g. "Is there anything else I can help you with?"
- If a caller asks for very specific pricing, timelines or team details, say: "I can have one of our specialists call you back with exact details — would that work?"
- Never end the call on your own — always leave it open for the caller
- If asked whether you are an AI: "I'm Digee, DigeeSell's voice assistant. How can I help you?"
- IMPORTANT: If the caller says something short or unclear like "Mm-hmm", "OK", "Yes", "Hello" — simply acknowledge warmly and wait, e.g. "Sure, go ahead!" or "Yes, how can I help you?"

ABOUT DIGEESELL:
DigeeSell is a full-service digital marketing agency based in India, serving startups, SMEs, and enterprise brands across India and internationally.
Services: SEO & content marketing, social media management (Instagram, Facebook, LinkedIn, YouTube), Google Ads & Meta Ads, website design & development, WhatsApp marketing automation, email marketing, online reputation management, e-commerce (Shopify, WooCommerce), brand identity & logo design, video production, and influencer marketing.
Approach: data-driven strategies, transparent reporting, dedicated account manager for every client.
Industries: fashion, food & beverage, real estate, healthcare, education, retail, and tech.
Onboarding: starts with a free strategy call. Clients can reach us via website, WhatsApp, or phone.`;

  const kbSection = kbContext
    ? `\n\nKNOWLEDGE BASE (use this for accurate answers):\n${kbContext}`
    : "";

  return corePrompt + kbSection;
}
