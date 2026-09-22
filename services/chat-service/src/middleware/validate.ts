import type { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import AppError from '../utils/AppError.ts';
import logger from '../utils/logger.ts';

export const validateQuery = (schema: Joi.ObjectSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const { error, value } = schema.validate(req.query);
        if (error) {
            logger.error({ error, path: req.path, method: req.method }, 'Validation error');
            return next(new AppError(error.details[0].message, 400));
        }
        req.query = value;
        next();
    };
};
