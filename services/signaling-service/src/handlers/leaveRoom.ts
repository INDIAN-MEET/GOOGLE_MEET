import { Socket } from 'socket.io';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

/**  
 * @description Leave room handler
 * @argument socket
 * @returns {void}
 */
async function cleanUp(socket: Socket) {
    const roomCode = socket.data.roomCode

    if (!roomCode) {
        logger.info('Socket is not in a room');
        return;
    }

    const setKey = `room:${roomCode}:members`
    await redis.srem(setKey, socket.id)

    socket.to(roomCode).emit('peer-left', { socketId: socket.id })
}

export function registerLeaveRoom(socket: Socket) {
    logger.info(`Trigger registerLeaveRoom for socket ${socket.id}`)
    socket.on('leave-room', () => cleanUp(socket))
    socket.on('disconnect', () => cleanUp(socket))
}