// =============================================================
// ✅ CONFIGURATION FILE — loads all environment variables
// =============================================================

// --- Load .env safely from project root ---
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// --- Helper to mask sensitive info before logging ---
function mask(value, keep = 4) {
  if (!value) return "";
  const visible = value.slice(0, keep);
  return value.length > keep ? `${visible}***` : value;
}

// --- Build config object ---
export const CONFIG = {
  PORT: process.env.PORT || 5010,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",

  TWILIO: {
    VOICE_LANGUAGE: process.env.TWILIO_VOICE_LANGUAGE || "en-IN",
    VOICE_HINTS: process.env.TWILIO_VOICE_HINTS || "sales,representatives,leads,clients,active,present,count,list",
    FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || "",
  },

  SALESREP_API: {
    URL: process.env.SALESREP_API_URL || "",
    AUTH_TYPE: (process.env.SALESREP_API_AUTH_TYPE || "none").toLowerCase(),
    BEARER: process.env.SALESREP_API_BEARER || "",
    HEADER_KEY: process.env.SALESREP_API_HEADER_KEY || "",
    HEADER_VALUE: process.env.SALESREP_API_HEADER_VALUE || "",
  },

  SUPABASE: {
    URL: process.env.SUPABASE_URL || "",
    SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || "",
  },

  FORWARD_TO_NUMBER: process.env.FORWARD_TO_NUMBER || "",

  VOBIZ: {
    AUTH_ID: process.env.VOBIZ_AUTH_ID || "",
    AUTH_TOKEN: process.env.VOBIZ_AUTH_TOKEN || "",
    NUMBER: process.env.VOBIZ_NUMBER || "",
  },
};

// --- Log essential environment info on startup ---
console.log("==============================================");
console.log("🧩 ENVIRONMENT CONFIGURATION LOADED SUCCESSFULLY");
console.log("🌐 PUBLIC_BASE_URL:", CONFIG.PUBLIC_BASE_URL || "(none)");
console.log("🤖 OPENAI_MODEL:", CONFIG.OPENAI_MODEL);
console.log("🎙️  TWILIO VOICE_LANGUAGE:", CONFIG.TWILIO.VOICE_LANGUAGE);
console.log("📦 SALESREP_API_URL:", CONFIG.SALESREP_API.URL || "(not set)");
console.log("🔐 SALESREP_API_AUTH_TYPE:", CONFIG.SALESREP_API.AUTH_TYPE);
if (CONFIG.SALESREP_API.AUTH_TYPE === "bearer")
  console.log("   → Bearer token:", mask(CONFIG.SALESREP_API.BEARER));
if (CONFIG.SALESREP_API.AUTH_TYPE === "header")
  console.log(
    `   → Header: ${CONFIG.SALESREP_API.HEADER_KEY}: ${mask(
      CONFIG.SALESREP_API.HEADER_VALUE
    )}`
  );
console.log("==============================================\n");
