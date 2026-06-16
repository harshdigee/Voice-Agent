// =============================================================
// makeVobizOutboundCall.js
// Initiates an outbound call via Vobiz REST API.
// Docs: https://docs.vobiz.ai/call/make-call
//
// Usage: node makeVobizOutboundCall.js [to_number]
//   e.g. node makeVobizOutboundCall.js +916389671091
// If no number given, uses OUTBOUND_TO_NUMBER from .env
// =============================================================
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const AUTH_ID    = process.env.VOBIZ_AUTH_ID;
const AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN;
const FROM       = process.env.VOBIZ_NUMBER;        // +918071580058
const TO         = process.argv[2] || process.env.OUTBOUND_TO_NUMBER;
const BASE_URL   = process.env.PUBLIC_BASE_URL;

// ── Validation ───────────────────────────────────────────────
const missing = [];
if (!AUTH_ID)    missing.push("VOBIZ_AUTH_ID");
if (!AUTH_TOKEN) missing.push("VOBIZ_AUTH_TOKEN");
if (!FROM)       missing.push("VOBIZ_NUMBER");
if (!TO)         missing.push("OUTBOUND_TO_NUMBER (or pass as CLI arg)");
if (!BASE_URL)   missing.push("PUBLIC_BASE_URL");

if (missing.length) {
  console.error("❌ Missing required env vars:", missing.join(", "));
  process.exit(1);
}

// ── Make the call ────────────────────────────────────────────
async function makeCall() {
  const url = `https://api.vobiz.ai/api/v1/Account/${AUTH_ID}/Call/`;

  const payload = {
    from: FROM,
    to: TO,
    answer_url: `${BASE_URL}/vobiz/inbound`,
    answer_method: "POST",
    hangup_url: `${BASE_URL}/vobiz/status`,
    hangup_method: "POST",
    time_limit: 3600,
  };

  console.log("\n📞 Vobiz Outbound Call");
  console.log("─────────────────────────────");
  console.log("From (caller ID):", FROM);
  console.log("To              :", TO);
  console.log("Answer URL      :", payload.answer_url);
  console.log("Hangup URL      :", payload.hangup_url);
  console.log("─────────────────────────────\n");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID":    AUTH_ID,
      "X-Auth-Token": AUTH_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (res.ok) {
    console.log("✅ Call fired successfully!");
    console.log("   Request UUID :", data.request_uuid);
    console.log("   API ID       :", data.api_id);
    console.log("   Message      :", data.message);
  } else {
    console.error("❌ Call failed (HTTP", res.status, ")");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

makeCall().catch((err) => {
  console.error("❌ Unexpected error:", err.message);
  process.exit(1);
});
