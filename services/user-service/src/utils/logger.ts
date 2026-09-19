import pino from 'pino';
import { NODE_ENV } from '../config/env.js';

const isDevelopment = NODE_ENV !== 'production';

const logger = pino({
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