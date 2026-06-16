/**
 * server.js — Digee Voice AI (Vobiz-only)
 *
 * HTTP  POST /vobiz/inbound   → returns <Stream> XML, Vobiz opens WS to /vobiz/stream
 * WS         /vobiz/stream    → bidirectional real-time audio (STT → LLM → TTS + barge-in)
 * HTTP  POST /vobiz/webhook   → call lifecycle events
 * HTTP  POST /vobiz/status    → final call status
 * HTTP  POST /vobiz/outbound  → fire an outbound call via Vobiz REST API
 * HTTP  GET  /health          → health check
 */

import { createServer } from "http";
import { WebSocketServer } from "ws";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

import { CONFIG } from "./config.js";
import { requestLogger } from "./middlewares/requestLogger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import vobizRoutes from "./routes/vobiz.js";
import { handleVobizStream } from "./controllers/vobizStreamController.js";
import { log } from "./utils/logger.js";

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(requestLogger);

app.get("/health", (_req, res) =>
  res.json({ ok: true, agent: "Digee", ts: new Date().toISOString() })
);
app.use("/vobiz", vobizRoutes);
app.use(errorHandler);

// ─── HTTP + WebSocket (same port) ────────────────────────────────────────────
const httpServer = createServer(app);

// Vobiz stream connects to /vobiz/stream
const wss = new WebSocketServer({ server: httpServer, path: "/vobiz/stream" });
wss.on("connection", (ws, req) => {
  log.info(`[wss] Vobiz stream connected from ${req.socket.remoteAddress}`);
  handleVobizStream(ws);
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(CONFIG.PORT, () => {
  log.info(`🎙️  Digee (Vobiz) live on http://localhost:${CONFIG.PORT}`);
  if (CONFIG.PUBLIC_BASE_URL) {
    const base = CONFIG.PUBLIC_BASE_URL;
    const wss  = base.replace("https://", "wss://").replace("http://", "ws://");
    log.info(`📞 Vobiz answer URL  → ${base}/vobiz/inbound`);
    log.info(`🔌 Vobiz stream WS   → ${wss}/vobiz/stream`);
    log.info(`🔔 Vobiz webhook     → ${base}/vobiz/webhook`);
    log.info(`📊 Vobiz status URL  → ${base}/vobiz/status`);
    log.info(`📤 Outbound trigger  → POST ${base}/vobiz/outbound`);
  }
});
