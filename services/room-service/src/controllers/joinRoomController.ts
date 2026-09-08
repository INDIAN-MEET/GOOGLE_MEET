import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

/**
 * Adds the authenticated user as a participant of an active room.
 *
 * Looks up the room by its shareable code; rejects if the room
 * doesn't exist or has already ended (`isActive: false`).
 *
 * @route POST /rooms/:code/join
 * @param {Request} req - Express request; expects `req.params.code`
 *                         and `req.userId` (set by authGuard)
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express error-forwarding function
 * @returns {Promise<void>} 200 with `{ room, participant }` on success
 * @throws {AppError} 401 if `req.userId` is missing
 * @throws {AppError} 404 if the room doesn't exist or has ended
 * @throws {AppError} 500 on database failure
 */
export const joinRoomController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // FIX: code comes from the URL param, not the body
    const { code } = req.params as any;
    const userId = req.userId;

    try {
        if (!userId) {
            return next(new AppError('Unauthorized', 401));
        }

        const room = await prisma.room.findUnique({ where: { code } });

        if (!room || !room.isActive) {
            return next(new AppError('Room not found or has ended', 404));
        }

        const participant = await prisma.roomParticipant.create({
            data: { roomId: room.id, userId }
        });

        logger.info({ room, participant }, 'Room joined');
        successResponse(res, { room, participant });
    } catch (err) {
        logger.error({ err, path: req.path, method: req.method }, 'Error joining room');
        return next(new AppError('Error joining room', 500));
    }
};