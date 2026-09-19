import { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: err.message
        })
    }

    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

    return res.status(500).json({
        success: false,
        error: 'Internal server error'
    })
};