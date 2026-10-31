import type { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

export const validateQuery = (schema: Joi.ObjectSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const { error, value } = schema.validate(req.query);
        if (error) {
            logger.error({ error, path: req.path, method: req.method }, 'Validation error');
            return next(new AppError(error.details[0]?.message ?? 'Validation error', 400));
        }
        try {
            Object.assign(req.query, value);
        } catch {
            // req.query is read-only in Express 5
        }
        res.locals.query = value;
        next();
    };
};
