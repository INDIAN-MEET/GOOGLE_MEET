import { Socket } from 'socket.io';
import redis from '../config/redis.js';
import { DEFAULT_ROOM_MODE } from '../config/env.js';
import { getActiveRoom } from '../config/roomServiceClient.js';
import logger from '../utils/logger.js';

/**
 * registerJoinRoom(socket)
 *
 * STEP 1: Refuse a second join while this socket is already in a room.
 *         The client must send "leave-room" first, otherwise the old
 *         room would keep a ghost peer (members set + SFU peer).
 *
 * STEP 2: Check the room exists and is active (Room Service).
 *
 * STEP 3: Decide the room mode. SET ... NX only writes when the key is
 *         missing, so the FIRST joiner decides and everyone after reads
 *         the same value. This is the "once SFU, always SFU" rule.
 *         The 24h expiry is a safety net if cleanup never runs.
 *
 * STEP 4: Add the socket to the Redis members set and the Socket.io room.
 *
 * STEP 5: Answer the joiner with the existing members AND the mode.
 *
 * STEP 6: Tell everyone else a peer joined (unchanged).
 */
export function registerJoinRoom(socket: Socket) {
    socket.on('join-room', async ({ roomCode }: { roomCode: string }) => {
        logger.info(` Trigger registerJoinRoom for room ${roomCode}`)

        // STEP 1
        if (socket.data.roomCode) {
            socket.emit('join-error', 'Already in a room. Leave it first.');
            return;
        }

        try {
            // STEP 2
            await getActiveRoom(roomCode, socket.data.token);

            // STEP 3
            const modeKey = `room:${roomCode}:mode`;
            await redis.set(modeKey, DEFAULT_ROOM_MODE, 'EX', 60 * 60 * 24, 'NX');
            const mode = (await redis.get(modeKey)) ?? DEFAULT_ROOM_MODE;

            // STEP 4
            const setKey = `room:${roomCode}:members`
            const roomMembers = await redis.smembers(setKey)

            await redis.sadd(setKey, socket.id)
            socket.join(roomCode)
            socket.data.roomCode = roomCode

            // STEP 5
            socket.emit('joined', {
                existingMembers: roomMembers,
                mode,
            })

            logger.info(`Socket ${socket.id} joined room ${roomCode} (mode=${mode})`)

            // STEP 6
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