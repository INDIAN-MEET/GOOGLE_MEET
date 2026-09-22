import { createClient } from 'redis';
import { REDIS_URL } from './env.ts';
import logger from '../utils/logger.ts';

/**
 * Dedicated Redis client for the chat-service subscriber.
 * Uses the `redis` npm package (same as chatMessageSubscriber).
 * This client is for pub operations only — the subscriber
 * uses its own separate connection in chatMessageSubscriber.ts
 * (Redis protocol requires separate connections for pub vs sub).
 */
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => logger.error('[chat-service] Redis client error', err));
redisClient.on('connect', () => logger.info('[chat-service] Redis client connected'));

export async function connectRedis(): Promise<void> {
    await redisClient.connect();
}

export default redisClient;
