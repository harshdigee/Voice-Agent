import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function mask(value, keep = 4) {
  if (!value) return "(not set)";
  return value.length > keep ? `${value.slice(0, keep)}***` : value;
}

export const CONFIG = {
  PORT:           process.env.PORT           || 5010,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",
  OUTBOUND_TO_NUMBER: process.env.OUTBOUND_TO_NUMBER || "",

  // ── OpenAI — LLM for agent replies (optional; falls back to Groq LLaMA) ─
  OPENAI: {
    API_KEY: process.env.OPENAI_API_KEY || "",
    MODEL:   process.env.OPENAI_MODEL   || "gpt-4o-mini",
  },

  // ── Groq — STT (Whisper) + TTS (Orpheus) + fallback LLM ─────────────────
  GROQ: {
    API_KEY:   process.env.GROQ_API_KEY   || "",
    STT_MODEL: process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
    LLM_MODEL: process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile",
    TTS_MODEL: process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
    TTS_VOICE: process.env.GROQ_TTS_VOICE || "diana",
  },

  // ── Supabase knowledge base (optional) ──────────────────────────────────
  SUPABASE: {
    URL:         process.env.SUPABASE_URL         || "",
    SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || "",
  },

  // ── Vobiz telephony ──────────────────────────────────────────────────────
  VOBIZ: {
    AUTH_ID:    process.env.VOBIZ_AUTH_ID    || "",
    AUTH_TOKEN: process.env.VOBIZ_AUTH_TOKEN || "",
    NUMBER:     process.env.VOBIZ_NUMBER     || "",
  },

  // ── Call forwarding ──────────────────────────────────────────────────────
  FORWARD_TO_NUMBER: process.env.FORWARD_TO_NUMBER || "",
};

console.log("==============================================");
console.log("🤖 Digee — DigeeSell Voice AI (Vobiz)");
console.log("🌐 PUBLIC_BASE_URL :", CONFIG.PUBLIC_BASE_URL || "(none)");
console.log("⚡ GROQ STT        :", CONFIG.GROQ.STT_MODEL);
console.log("🤖 LLM (agent)     :", CONFIG.OPENAI.API_KEY
  ? `OpenAI ${CONFIG.OPENAI.MODEL}`
  : `Groq ${CONFIG.GROQ.LLM_MODEL} (add OPENAI_API_KEY to use GPT)`);
console.log("⚡ GROQ TTS        :", `${CONFIG.GROQ.TTS_MODEL} / ${CONFIG.GROQ.TTS_VOICE}`);
console.log("🔑 GROQ API KEY    :", mask(CONFIG.GROQ.API_KEY));
console.log("🔑 OPENAI API KEY  :", CONFIG.OPENAI.API_KEY ? mask(CONFIG.OPENAI.API_KEY) : "(not set — using Groq LLM)");
console.log("📞 VOBIZ NUMBER    :", CONFIG.VOBIZ.NUMBER || "(not set)");
console.log("==============================================\n");
