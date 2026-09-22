import type { Server, Socket } from 'socket.io';
import { publishChatMessage } from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * @description Registers the `chat-message` socket event handler.
 *
 * When a client emits `chat-message`, this handler does TWO things in parallel:
 *   A) Instantly relays the message to all other sockets in the same room (realtime).
 *   B) Publishes to Redis `chat-message` channel (fire-and-forget) so
 *      chat-service can persist it to MongoDB asynchronously.
 *
 * Signaling never touches MongoDB directly — it just publishes and moves on.
 *
 * @param io   - Socket.io server (needed to emit to all sockets in a room)
 * @param socket - The authenticated socket sending the message
 */
export function registerChatMessage(io: Server, socket: Socket): void {
    socket.on('chat-message', async ({
        roomId,
        text,
        senderName,
    }: {
        roomId: string;
        text: string;
        senderName?: string;   // client may send display name; falls back to userId
    }) => {
        logger.info(`[chat-message] from userId=${socket.data.userId} in room=${roomId}`);

        if (!roomId || !text?.trim()) {
            logger.warn('[chat-message] Dropped — missing roomId or text');
            socket.emit('chat-error', 'roomId and text are required');
            return;
        }

        const payload = {
            roomId,
            senderId:   socket.data.userId as string,
            senderName: senderName ?? (socket.data.userId as string),
            text:       text.trim(),
        };

        // ── PART A: Instant relay ──────────────────────────────────────────
        // Everyone in the room (including sender) sees the message immediately.
        // This is pure in-memory — no DB, no Redis needed.
        io.to(roomId).emit('chat-message', payload);

        // ── PART B: Persistence (fire-and-forget) ─────────────────────────
        // Publish to Redis → chat-service picks it up → saves to MongoDB.
        // If chat-service is slow or down, live chat is completely unaffected.
        try {
            await publishChatMessage(payload);
            logger.info(`[chat-message] Published to Redis for room=${roomId}`);
        } catch (err: any) {
            // Log but never crash the socket handler — realtime already worked.
            logger.error(`[chat-message] Redis publish failed: ${err?.message}`);
        }
    });
}
