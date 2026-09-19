import { createClient } from 'redis';
import { REDIS_URL } from '../config/env.ts';
import { ChatMessage } from '../models/ChatMessage.ts';
import logger from '../utils/logger.ts';

interface ChatMessagePayload {
    roomId: string;
    senderId: string;
    senderName: string;
    text: string;
}

/**  
 * Subscribe to "chat-message" channel
 * @description Subscribe to "chat-message" channel
 * @function startChatMessageSubscriber
 * @returns {Promise<void>}
 */
export const startChatMessageSubscriber = async (): Promise<void> => {
    const subscriber = createClient({ url: REDIS_URL });

    subscriber.on('error', (err) => logger.error('[chat-subscriber] Redis error', err));

    await subscriber.connect();

    await subscriber.subscribe('chat-message', async (rawMessage) => {
        try {
            const payload: ChatMessagePayload = JSON.parse(rawMessage);

            if (!payload.roomId || !payload.senderId || !payload.text) {
                logger.warn('[chat-subscriber] Dropped malformed payload', payload as any || rawMessage);
                return;
            }

            await ChatMessage.create({
                roomId: payload.roomId,
                senderId: payload.senderId,
                senderName: payload.senderName,
                text: payload.text,
            });

            logger.info(`[chat-subscriber] Persisted message for room ${payload.roomId}`);
        } catch (err:any) {
            // Deliberately swallow-and-log, not throw: a bad message must never
            // crash the subscriber loop and take down persistence for every
            // other room's messages.
            logger.error('[chat-subscriber] Failed to persist message', err);
        }
    });

    logger.info('[chat-subscriber] Subscribed to "chat-message" channel');
};