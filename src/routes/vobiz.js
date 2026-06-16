/**
 * vobiz.js — All Vobiz call routes
 *
 * POST /vobiz/inbound  → Answer URL; returns <Stream> to open real-time WebSocket
 * WS   /vobiz/stream   → Bidirectional audio (handled in server.js → vobizStreamController)
 * POST /vobiz/webhook  → Real-time call lifecycle events (ring, hangup, etc.)
 * POST /vobiz/status   → Final call status (duration, disposition)
 * POST /vobiz/outbound → Utility: fire an outbound call via Vobiz REST API
 */

import { Router } from "express";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { stream, speak, hangup, response, sendXml } from "../services/vobizXml.js";
import fetch from "node-fetch";

const router = Router();

// Resolve the public base URL from the *actual* request that reached us
// (via ngrok / load balancer), falling back to the configured value.
// This guarantees the WebSocket URL we hand back to Vobiz always points at
// the same host the call arrived on — so a stale/typo'd PUBLIC_BASE_URL in
// .env can never silently break the media stream.
function publicBaseFromReq(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return CONFIG.PUBLIC_BASE_URL;
}

// ─── POST /vobiz/inbound ──────────────────────────────────────────────────────
// Vobiz calls this when a call is received (inbound) or answered (outbound).
// We return <Stream> so all audio flows through our WebSocket pipeline.
router.post("/inbound", (req, res) => {
  const { From, To, CallUUID, Direction } = req.body || {};
  log.info(`[vobiz/inbound] ${Direction || "inbound"} call from=${From} to=${To} uuid=${CallUUID}`);

  const base = publicBaseFromReq(req);
  const wsUrl = base
    .replace(/^https?:\/\//, (m) => (m.startsWith("https") ? "wss://" : "ws://"))
    + "/vobiz/stream";

  log.info(`[vobiz/inbound] connecting to stream: ${wsUrl}`);

  // <Stream> hands the call off to our WebSocket handler.
  // Digee's greeting is played inside the WS handler once the stream starts.
  const xml = response(stream(wsUrl));
  sendXml(res, xml);
});

// ─── POST /vobiz/webhook ──────────────────────────────────────────────────────
// Async event notifications: Initiated, Ringing, Answered, Hangup
router.post("/webhook", (req, res) => {
  const { Event, CallStatus, CallUUID, From, To, Duration } = req.body || {};
  log.info(`[vobiz/webhook] event=${Event} status=${CallStatus} uuid=${CallUUID} from=${From} to=${To} duration=${Duration || "-"}`);
  res.status(200).json({ ok: true });
});

// ─── POST /vobiz/status ───────────────────────────────────────────────────────
// Final call completion callback (hangup_url)
router.post("/status", (req, res) => {
  const { CallStatus, From, To, Duration, CallUUID } = req.body || {};
  log.info(`[vobiz/status] status=${CallStatus} from=${From} to=${To} duration=${Duration}s uuid=${CallUUID}`);
  res.status(200).json({ ok: true });
});

// ─── POST /vobiz/outbound ─────────────────────────────────────────────────────
// Convenience endpoint: trigger an outbound call via the Vobiz REST API.
// Body: { to: "+91XXXXXXXXXX" }   (from / credentials pulled from .env)
router.post("/outbound", async (req, res) => {
  const to = req.body?.to || CONFIG.OUTBOUND_TO_NUMBER;
  if (!to) return res.status(400).json({ error: "Missing 'to' number" });

  const { AUTH_ID, AUTH_TOKEN, NUMBER: from } = CONFIG.VOBIZ;
  if (!AUTH_ID || !AUTH_TOKEN || !from) {
    return res.status(500).json({ error: "Vobiz credentials not configured in .env" });
  }

  const payload = {
    from,
    to,
    answer_url:    `${CONFIG.PUBLIC_BASE_URL}/vobiz/inbound`,
    answer_method: "POST",
    hangup_url:    `${CONFIG.PUBLIC_BASE_URL}/vobiz/status`,
    hangup_method: "POST",
    time_limit:    3600,
  };

  try {
    const apiRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${AUTH_ID}/Call/`, {
      method:  "POST",
      headers: {
        "X-Auth-ID":    AUTH_ID,
        "X-Auth-Token": AUTH_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await apiRes.json();
    if (apiRes.ok) {
      log.info(`[vobiz/outbound] call fired to=${to} request_uuid=${data.request_uuid}`);
      res.json({ ok: true, request_uuid: data.request_uuid, message: data.message });
    } else {
      log.error("[vobiz/outbound] Vobiz API error:", JSON.stringify(data));
      res.status(apiRes.status).json({ ok: false, error: data });
    }
  } catch (err) {
    log.error("[vobiz/outbound] fetch error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
