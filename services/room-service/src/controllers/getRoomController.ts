import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

/**
 * Fetches a single room by its shareable code, along with its
 * currently active participants (those who haven't left yet).
 *
 * @route GET /rooms/:code
 * @param {Request} req - Express request; expects `req.params.code`
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express error-forwarding function
 * @returns {Promise<void>} 200 with `{ room }` (includes `participants` array)
 * @throws {AppError} 404 if no room matches the given code
 * @throws {AppError} 500 on database failure
 */
export const getRoomController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // FIX: code comes from the URL, not the body — GET requests
    // shouldn't rely on req.body, and req.body is always truthy ({}),
    // so the old ternary silently ignored req.params every time.
    const { code } = req.params as any;

    try {
        const room = await prisma.room.findUnique({
            where: { code },
            include: { participants: { where: { leftAt: null } } }
        });

        if (!room) {
            return next(new AppError('Room not found', 404));
        }

        logger.info({ room }, 'Room found');
        successResponse(res, { room });
    } catch (err) {
        logger.error({ err, path: req.path, method: req.method }, 'Error getting room');
        return next(new AppError('Error getting room', 500));
    }
};