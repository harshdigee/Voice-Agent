import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { CONFIG } from './config.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import voiceRoutes from './routes/voice.js';
import { log } from './utils/logger.js';

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true })); // Twilio posts urlencoded
app.use(bodyParser.json());
app.use(requestLogger);

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/voice', voiceRoutes);

// Error handler
app.use(errorHandler);

app.listen(CONFIG.PORT, () => {
  log.info(`📞 Voice AI Server listening on http://localhost:${CONFIG.PORT}`);
  if (CONFIG.PUBLIC_BASE_URL) {
    log.info(`👉 Twilio webhook: ${CONFIG.PUBLIC_BASE_URL}/voice/inbound`);
  }
});
