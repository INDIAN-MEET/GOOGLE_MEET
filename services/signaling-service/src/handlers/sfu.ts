import type { Socket } from 'socket.io';
import * as sfu from '../config/sfuClient.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/**
 * sfu.ts
 *
 * STEP 1: getRoom() returns the room this socket joined in join-room.
 *         The client NEVER sends a roomId. A user cannot reach a room
 *         they have not joined, and not joined = 403.
 *
 * STEP 2: handle() wraps one event. It ignores calls without an ack
 *         callback, marks the socket as an SFU user (so cleanup knows
 *         to call the SFU), runs the handler, and turns ANY error into
 *         an ack error. The browser always gets an answer.
 *
 * STEP 3: Ack shape matches the SFU:
 *         success -> { success: true, data }
 *         failure -> { success: false, statusCode, message }
 *
 * STEP 4: peerId is ALWAYS socket.id. Nothing the client sends can
 *         change who it acts as.
 *
 * STEP 5: "produce" also tells the other peers with new-producer.
 *         Cleanup (producer-closed, peer-left) lives in leaveRoom.ts.
 */

type Ack = (res: unknown) => void;

// STEP 1
function getRoom(socket: Socket): string {
    const roomCode = socket.data.roomCode as string | undefined;
    if (!roomCode) throw new AppError('Join a room first', 403);
    return roomCode;
}

// STEP 2
function handle(
    socket: Socket,
    event: string,
    fn: (roomCode: string, payload: any) => Promise<unknown>,
) {
    socket.on(event, async (payload: any, ack?: Ack) => {
        if (typeof ack !== 'function') return;

        try {
            const roomCode = getRoom(socket);
            socket.data.usesSfu = true;

            const data = await fn(roomCode, payload ?? {});
            ack({ success: true, data });                                   // STEP 3
        } catch (err: any) {
            const statusCode = err instanceof AppError ? err.statusCode : 500;

            if (statusCode >= 500) {
                logger.error({ err, event, socketId: socket.id }, 'SFU event failed');
            }

            ack({
                success: false,
                statusCode,
                message: err instanceof AppError ? err.message : 'Internal error',
            });
        }
    });
}

export function registerSfuHandlers(socket: Socket): void {
    logger.info(`Trigger registerSfuHandlers for socket ${socket.id}`);

    // STEP 4: peerId = socket.id in every call below
    handle(socket, 'get-router-capabilities', (roomCode) =>
        sfu.getRouterCapabilities(roomCode));

    handle(socket, 'create-transport', (roomCode, { direction }) =>
        sfu.createTransport(roomCode, socket.id, direction));

    handle(socket, 'connect-transport', (roomCode, { transportId, dtlsParameters }) =>
        sfu.connectTransport(roomCode, socket.id, transportId, dtlsParameters));

    // STEP 5
    handle(socket, 'produce', async (roomCode, { transportId, kind, rtpParameters, source }) => {
        /**
         * STEP 5a: userId comes from socket.data (set by socketAuth from the JWT).
         *          Nothing the client sends can change it.
         */
        const result = await sfu.produce(
            roomCode, socket.id, transportId, kind, rtpParameters, source,
            socket.data.userId as string,                               // STEP 5a
        );

        socket.to(roomCode).emit('new-producer', {
            producerId: result.producerId,
            socketId: socket.id,
            kind,
            source,
        });

        return result;
    });

    handle(socket, 'get-producers', (roomCode) =>
        sfu.listProducers(roomCode, socket.id));

    handle(socket, 'consume', (roomCode, { producerId, rtpCapabilities }) =>
        sfu.consume(roomCode, socket.id, producerId, rtpCapabilities));

    handle(socket, 'resume-consumer', (roomCode, { consumerId }) =>
        sfu.resumeConsumer(roomCode, socket.id, consumerId));
}