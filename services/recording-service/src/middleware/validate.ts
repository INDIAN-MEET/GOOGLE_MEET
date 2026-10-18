import type { NextFunction, Request, Response } from 'express';
import type Joi from 'joi';
import { AppError } from '../utils/AppError.ts';

/**
 * validate(schema, where)
 * Checks req.body or req.params with Joi. Bad input -> 400 with all messages.
 * Only the body is replaced with the cleaned value (unknown fields removed).
 */
export const validate =
  (schema: Joi.ObjectSchema, where: 'body' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[where], { abortEarly: false, stripUnknown: true });
    if (error) return next(new AppError(error.details.map((d) => d.message).join(', '), 400));
    if (where === 'body') req.body = value;
    next();
  };