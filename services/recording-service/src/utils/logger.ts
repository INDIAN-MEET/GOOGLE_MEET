import pino from 'pino';
import { env } from '../config/env.ts';
import { traceMixin } from '../observability/logContext.js';

/**
 * logger: one shared Pino logger. Level is "info" in dev, "warn" in production.
 */
export const logger = pino({
  level: env.nodeEnv === 'production' ? 'warn' : 'info',
  mixin: traceMixin,
});