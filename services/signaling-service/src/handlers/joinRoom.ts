import { Socket } from 'socket.io';
import redis from '../config/redis.js';
import { getActiveRoom } from '../config/roomServiceClient.js';
import logger from '../utils/logger.js';


/**   
 * @description Join room handler 
 * @argument socket
 * @returns {void}
 * @throws {Error}
 * @fileoverview first check if room exists, then add socket to room, then emit "joined" event
 */
export function registerJoinRoom(socket: Socket) {
    socket.on('join-room', async ({ roomCode }: { roomCode: string }) => {
        logger.info(` Trigger registerJoinRoom for room ${roomCode}`)
        try {
            await getActiveRoom(roomCode, socket.data.token);
            const setKey = `room:${roomCode}:members`
            const roomMembers = await redis.smembers(setKey)

            await redis.sadd(setKey, socket.id)
            socket.join(roomCode)
            socket.data.roomCode = roomCode

            socket.emit('joined', {
                existingMembers: roomMembers
            })

            logger.info(`Socket ${socket.id} joined room ${roomCode}`)

            socket.to(roomCode).emit("peer-joined", {
                socketId: socket.id,
                userId: socket.data.userId
            })


        } catch (err: any) {
            logger.error('Room not found or has ended', err)
            socket.emit('join-error', 'Room not found or has ended');
            return
        }
    })

}