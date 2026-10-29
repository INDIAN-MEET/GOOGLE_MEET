import pino from 'pino';
import { env } from '../config/env.ts';
import { traceMixin } from '../observability/logContext.js';

export const logger = pino({
  level: env.logLevel,
  mixin: traceMixin,
});