import pino from 'pino';
import { NODE_ENV } from '../config/env.js';
import { traceMixin } from '../observability/logContext.js';

const isDevelopment = NODE_ENV !== 'production';

const logger = pino({
    mixin: traceMixin,
    level: isDevelopment ? 'debug' : 'info',
    transport: isDevelopment
        ? {
              target: 'pino-pretty',
              options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  ignore: 'pid,hostname'
              }
          }
        : undefined
});

export default logger;