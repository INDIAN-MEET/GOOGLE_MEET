import Redis from 'ioredis';
import { REDIS_URL } from './env.js';
import logger from '../utils/logger.js';

const redis = new Redis(REDIS_URL);

redis.on('connect', () => logger.info('Redis connected successfully'));
redis.on('error', (err: any) => logger.error('Redis connection error:', err));

export default redis;