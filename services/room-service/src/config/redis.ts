import { Redis } from 'ioredis';
import { REDIS_URL } from './env.js';

/** Redis connection used only for publishing events. */
export const redisPub = new Redis(REDIS_URL);
