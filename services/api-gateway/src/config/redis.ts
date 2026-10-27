import { Redis } from 'ioredis';
import { REDIS_URL } from './env.js';
import logger from '../utils/logger.js';

/** Time of the last logged Redis error (ms since epoch), used to avoid log spam. */
let lastErrorLogAt = 0;

/**
 * Shared Redis client, used by the rate limiters and the `/ready` probe.
 * Commands fail within 2 seconds if Redis is down, and the client reconnects automatically.
 */
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('close', () => logger.warn('Redis connection closed'));
redis.on('error', (err: Error) => {
  const now = Date.now();
  if (now - lastErrorLogAt > 10_000) {
    lastErrorLogAt = now;
    logger.error({ err: err.message }, 'Redis error');
  }
});

export default redis;
