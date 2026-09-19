import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

/**
 * Marks the authenticated user's participation in a room as ended.
 *
 * Sets `leftAt` on any of the user's currently-active participant rows
 * for the given room (there should normally be exactly one).
 *
 * @route POST /rooms/:code/leave
 * @param {Request} req - Express request; expects `req.params.code`
 *                         and `req.userId` (set by authGuard)
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express error-forwarding function
 * @returns {Promise<void>} 200 with `{ room }` on success
 * @throws {AppError} 404 if the room doesn't exist
 * @throws {AppError} 500 on database failure
 */
export const leaveRoomController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // FIX: code comes from the URL param, not the body
        const { code } = req.params as any;

        const room = await prisma.room.findUnique({ where: { code } });

        if (!room) {
            logger.error({ code, path: req.path, method: req.method }, 'Room not found');
            return next(new AppError('Room not found', 404));
        }

        // Only touch rows that haven't already left, so re-calling
        // this endpoint doesn't overwrite a real leftAt timestamp.
        await prisma.roomParticipant.updateMany({
            where: { roomId: room.id, userId: req.userId, leftAt: null },
            data: { leftAt: new Date() }
        });

        logger.info({ room }, 'Room left');
        successResponse(res, { room });
    } catch (err: any) {
        logger.error({ err, path: req.path, method: req.method }, 'Error leaving room');
        return next(new AppError('Error leaving room', 500));
    }
};