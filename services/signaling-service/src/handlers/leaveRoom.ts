import { Socket } from 'socket.io';
import redis from '../config/redis.js';
import { leavePeer } from '../config/sfuClient.js';
import logger from '../utils/logger.js';

/**
 * cleanUp(socket)
 *
 * STEP 1: Read the room. No room = nothing to clean.
 *
 * STEP 2: Clear socket.data.roomCode and leave the Socket.io room
 *         BEFORE any await. This makes cleanUp idempotent: when
 *         "leave-room" and then "disconnect" both fire, the second
 *         call sees no room and stops (this also fixes the duplicate
 *         peer-left you had before).
 *
 * STEP 3: Remove the socket from the Redis members set.
 *         In its own try/catch so a Redis error cannot block the rest.
 *
 * STEP 4: If this socket ever used the SFU, call /peers/leave.
 *         It is idempotent on the SFU side too. In try/catch so a dead
 *         SFU never crashes signaling or blocks the peer-left.
 *
 * STEP 5: Broadcast producer-closed for every closed producer, so the
 *         other browsers remove those tiles.
 *
 * STEP 6: Broadcast peer-left (existing event, same payload as before).
 */
async function cleanUp(socket: Socket) {
    // STEP 1
    const roomCode = socket.data.roomCode as string | undefined;

    if (!roomCode) {
        logger.info('Socket is not in a room');
        return;
    }

    // STEP 2
    const usedSfu = socket.data.usesSfu === true;
    socket.data.roomCode = undefined;
    socket.data.usesSfu = false;
    await socket.leave(roomCode);

    /**
     * STEP 3: Remove the socket from the Redis members set.
     *         If it was the LAST member, also delete the room mode key
     *         so the next group of users starts fresh.
     *         In its own try/catch so a Redis error cannot block the rest.
     */
    try {
        const setKey = `room:${roomCode}:members`;
        await redis.srem(setKey, socket.id);

        if ((await redis.scard(setKey)) === 0) {
            await redis.del(`room:${roomCode}:mode`);
        }
    } catch (err) {
        logger.error({ err, roomCode }, 'Redis cleanup failed');
    }

    // STEP 4
    let closedProducerIds: string[] = [];

    if (usedSfu) {
        try {
            const result = await leavePeer(roomCode, socket.id);
            closedProducerIds = result.closedProducerIds;
        } catch (err) {
            logger.error({ err, roomCode, socketId: socket.id }, 'SFU leave failed');
        }
    }

    // STEP 5
    for (const producerId of closedProducerIds) {
        socket.to(roomCode).emit('producer-closed', { producerId, socketId: socket.id });
    }

    // STEP 6
    socket.to(roomCode).emit('peer-left', { socketId: socket.id });
}

export function registerLeaveRoom(socket: Socket) {
    logger.info(`Trigger registerLeaveRoom for socket ${socket.id}`)
    socket.on('leave-room', () => cleanUp(socket))
    socket.on('disconnect', () => cleanUp(socket))
}