import { log } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  log.error('Unhandled error:', err?.stack || err?.message || err);
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
}
