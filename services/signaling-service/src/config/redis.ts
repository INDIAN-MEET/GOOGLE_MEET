import Redis from 'ioredis';
import { REDIS_URL } from './env.js';
import logger from '../utils/logger.js';

const redis = new Redis(REDIS_URL);

redis.on('connect', () => logger.info('Redis connected successfully'));
redis.on('error', (err: any) => logger.error('Redis connection error:', err));

export interface ChatMessagePayload {
    roomId: string;
    senderId: string;
    senderName: string;
    text: string;
}

/**
 * @description Publish a chat message to the Redis `chat-message` channel.
 * chat-service subscribes to this channel and persists the message to MongoDB.
 * This is fire-and-forget — signaling never waits on chat-service.
 */
export async function publishChatMessage(payload: ChatMessagePayload): Promise<void> {
    await redis.publish('chat-message', JSON.stringify(payload));
}

export default redis;