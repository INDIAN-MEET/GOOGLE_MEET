import { Server, Socket } from 'socket.io';
import logger from '../utils/logger.js';

/**
 * Shape of every relay payload — targetSocketId tells us where to
 * forward the message, everything else (sdp, candidate) is passed
 * through untouched.
 */
interface RelayPayload {
    targetSocketId: string;
    [key: string]: any;
}



/**
 * @description Registers offer/answer/ice-candidate relay handlers.
 * All three do the same thing — forward the payload to targetSocketId,
 * tagging it with fromSocketId so the receiver knows who sent it.
 * @param io - Socket.io server instance, needed to target any socket by ID
 * @param socket - the socket sending offer/answer/ice-candidate events
 * @returns {void}
 */

export function registerRelayHandlers(io: Server, socket: Socket) {
    logger.info(`Trigger registerRelayHandlers for socket ${socket.id}`)
    /**  
     * @description Relay handler for offer/answer/ice-candidate events
     * @param event - the event name, e.g. 'offer', 'answer', 'ice-candidate'
     * @returns {void}
     * @emits {string} event
     */
    const relay = (event: string) => {
        return (payload: RelayPayload) => {
            const { targetSocketId, ...rest } = payload;
            io.to(targetSocketId).emit(event, { fromSocketId: socket.id, ...rest });
        }
    }

    socket.on('offer', relay('offer'));
    socket.on('answer', relay('answer'));
    socket.on('ice-candidate', relay('ice-candidate'));

}