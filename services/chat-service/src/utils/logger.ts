import pino from 'pino';
import { NODE_ENV } from '../config/env.js';

const isDevelopment = NODE_ENV !== 'production';

const logger = pino(
    isDevelopment
        ? {
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
        : { level: 'info' }
);

export default logger;