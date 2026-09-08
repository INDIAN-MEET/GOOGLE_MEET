import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

export const meController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const  userId  = req.userId
        const profile = await prisma.profile.findUnique({ where: { userId } });
        if (!profile) return next(new AppError('Profile not found', 404));
        logger.info(`Profile found for userId: ${userId}`);
        successResponse(res, { profile });
    } catch (err) {
        next(err);
    }
};