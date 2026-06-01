import fetch from "node-fetch";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

function buildAuthHeaders() {
  const headers = {};
  switch (CONFIG.SALESREP_API.AUTH_TYPE) {
    case "bearer":
      headers["Authorization"] = `Bearer ${CONFIG.SALESREP_API.BEARER}`;
      break;
    case "header":
      if (CONFIG.SALESREP_API.HEADER_KEY) {
        headers[CONFIG.SALESREP_API.HEADER_KEY] =
          CONFIG.SALESREP_API.HEADER_VALUE || "";
      }
      break;
    default:
      break;
  }
  return headers;
}

export async function fetchSalesReps() {
  const startTime = Date.now();

  if (!CONFIG.SALESREP_API.URL) {
    log.error("❌ SALESREP_API_URL not configured in .env");
    return { ok: false, error: "SALESREP_API_URL not configured", data: [] };
  }

  const headers = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(),
  };

  log.info("🌐 Fetching sales rep data...");
  log.info("➡️  URL:", CONFIG.SALESREP_API.URL);
  log.info(
    "➡️  Headers:",
    JSON.stringify(
      {
        ...headers,
        Authorization: headers.Authorization ? "***REDACTED***" : undefined,
      },
      null,
      2
    )
  );

  try {
    const resp = await fetch(CONFIG.SALESREP_API.URL, { headers });
    const endTime = Date.now();

    log.info(`🕒 API responded with status ${resp.status} in ${endTime - startTime}ms`);

    // get raw text for debugging
    const rawText = await resp.text();
    log.info("📦 Raw response body (first 500 chars):", rawText.slice(0, 500));

    let json;
    try {
      json = JSON.parse(rawText);
    } catch (err) {
      log.error("❌ Failed to parse JSON:", err.message);
      return { ok: false, error: "Invalid JSON", data: [] };
    }

    const list = json?.users || json?.data || [];

    log.info("✅ Parsed JSON keys:", Object.keys(json || {}));
    log.info(`👥 Found ${list.length} user records`);

    // Normalize from User model
    const normalized = list.map((u, i) => ({
      id: u.user_id || `u${i}`,
      name: u.username || "Unknown",
      email: u.email || "N/A",
      role: u.role || "sales_rep",
      active: u.status === "active",
      position: u.position || "",
      last_active: u.last_active || null,
    }));

    log.info(
      "🧾 Normalized sample:",
      JSON.stringify(normalized.slice(0, 3), null, 2)
    );

    const duration = Date.now() - startTime;
    log.info(`✅ SalesRep API fetch successful (${duration} ms)`);

    return { ok: true, data: normalized };
  } catch (err) {
    const duration = Date.now() - startTime;
    log.error("❌ fetchSalesReps error:", err.message || err);
    log.error(`⏱️  Total duration before error: ${duration} ms`);
    return { ok: false, error: String(err), data: [] };
  }
}

export function getCounts(reps, { activeOnly = false } = {}) {
  const total = reps.length;
  const active = reps.filter((r) => r.active).length;
  log.info(`📊 getCounts → total:${total}, active:${active}, activeOnly:${activeOnly}`);
  return { total, active, result: activeOnly ? active : total };
}

export function listNames(reps, limit = 5) {
  const names = reps.slice(0, limit).map((r) => r.name || "Unknown");
  log.info(`🧾 listNames → ${names.join(", ")}`);
  return names;
}
