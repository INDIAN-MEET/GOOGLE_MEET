import { Server } from 'socket.io'
import { socketAuth } from '../middleware/socketAuth.js';
import { registerJoinRoom } from '../handlers/joinRoom.js';
import { registerRelayHandlers } from '../handlers/relay.js';
import { registerLeaveRoom } from '../handlers/leaveRoom.js';
import logger from '../utils/logger.js';


/**  
 * @description Initialize socket.io server
 * @param io - Socket.io server instance
 * @returns {void}
 */
export function initSocket(io: Server) {

    io.use(socketAuth)
    logger.info('Socket.io server initialized');
    io.on('connection', (socket) => {
        logger.info(`Socket ${socket.id} connected`);
        registerJoinRoom(socket)
        registerRelayHandlers(io, socket)
        registerLeaveRoom(socket)
    })

}