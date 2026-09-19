import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { JWT_ACCESS_SECRET } from '../config/env.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/**  
 *@description Middleware to authenticate socket.io connections
 *@argument socket
 *@argument next
 *@returns {void} 
 */
export function socketAuth(socket: Socket, next: (err?: Error) => void) {
    const token = socket.handshake.auth?.token|| socket.handshake.query?.token;;

    if (!token) {
        logger.error('No token provided');
        return next(new AppError('No token provided', 401));
    }
    try {
        const paylode = jwt.verify(token, JWT_ACCESS_SECRET) as { userId: string }
        logger.info(`Socket authenticated: ${paylode.userId}`);
        socket.data.userId = paylode.userId;
        socket.data.token = token;
        next();
    } catch (error: any) {
        logger.error('Socket authentication error:', error);
        next(new AppError('Invalid or expired token', 401));
    }

}