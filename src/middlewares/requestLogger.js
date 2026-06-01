import { log } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  log.info(`${req.method} ${req.originalUrl}`);
  next();
}
