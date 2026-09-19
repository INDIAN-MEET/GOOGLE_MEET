import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { successResponse } from '../utils/response.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/**
 * Creates a new room owned by the authenticated user.
 *
 * Generates a short, human-shareable room code (e.g. "abc-defg-hij"),
 * then persists the room with `req.userId` as `hostUserId`.
 *
 * @route POST /rooms
 * @param {Request} req - Express request; expects `req.body.title` (optional)
 *                         and `req.userId` (set by authGuard)
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express error-forwarding function
 * @returns {Promise<void>} 201 with `{ room }` on success
 * @throws {AppError} 401 if `req.userId` is missing (should not happen post-authGuard)
 * @throws {AppError} 500 on database failure
 */
export const createRoomController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { title } = req.body;
        const roomCode = generateRoomCode();
        const userId = req.userId;

        if (!userId) {
            return next(new AppError('Unauthorized', 401));
        }

        const room = await prisma.room.create({
            data: { code: roomCode, title, hostUserId: userId }
        });

        logger.info({ room }, 'Room created');
        successResponse(res, { room });
    } catch (err: any) {
        logger.error({ err, path: req.path, method: req.method }, 'Error creating room');
        return next(new AppError('Error creating room', 500));
    }
};