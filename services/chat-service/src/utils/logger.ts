import pino from 'pino';
import { NODE_ENV } from '../config/env.js';
import { traceMixin } from '../observability/logContext.js';

const isDevelopment = NODE_ENV !== 'production';

const logger = pino(
    isDevelopment
        ? {
              mixin: traceMixin,
              level: 'debug',
              transport: {
                  target: 'pino-pretty',
                  options: {
                      colorize: true,
                      translateTime: 'SYS:standard',
                      ignore: 'pid,hostname',
                  },
              },
          }
        : {
              mixin: traceMixin,
              level: 'info',
          }
);

export default logger;