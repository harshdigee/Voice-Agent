import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { CONFIG } from './config.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import voiceRoutes from './routes/voice.js';
import vobizRoutes from './routes/vobiz.js';
import { log } from './utils/logger.js';

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(requestLogger);

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/voice', voiceRoutes);
app.use('/vobiz', vobizRoutes);

// Error handler
app.use(errorHandler);

app.listen(CONFIG.PORT, () => {
  log.info(`📞 Voice AI Server listening on http://localhost:${CONFIG.PORT}`);
  if (CONFIG.PUBLIC_BASE_URL) {
    log.info(`👉 Twilio webhook:          ${CONFIG.PUBLIC_BASE_URL}/voice/inbound`);
    log.info(`📞 Vobiz inbound URL:       ${CONFIG.PUBLIC_BASE_URL}/vobiz/inbound`);
    log.info(`📞 Vobiz collect URL:       ${CONFIG.PUBLIC_BASE_URL}/vobiz/collect`);
    log.info(`🔔 Vobiz event webhook:     ${CONFIG.PUBLIC_BASE_URL}/vobiz/webhook`);
    log.info(`📊 Vobiz status callback:   ${CONFIG.PUBLIC_BASE_URL}/vobiz/status`);
  }
});
