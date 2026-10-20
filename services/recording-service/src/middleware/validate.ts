import type { NextFunction, Request, Response } from 'express';
import type Joi from 'joi';
import { AppError } from '../utils/AppError.ts';

/**
 * Builds a middleware that validates `req.body`, `req.params`, or `req.query` with Joi.
 *
 * - body: replaced by the cleaned value (unknown fields removed).
 * - params: only checked.
 * - query: the cleaned value is stored in `res.locals.query` (req.query is read-only in Express 5).
 *
 * @param schema - Joi object schema.
 * @param where - Which part of the request to validate (default "body").
 * @returns An Express middleware that answers 400 with all messages on invalid input.
 */
export const validate =
  (schema: Joi.ObjectSchema, where: 'body' | 'params' | 'query' = 'body') =>
  /**
   * Express middleware created by validate().
   *
   * @param req - Request being validated.
   * @param res - Response (used to carry cleaned query values).
   * @param next - Continues the chain or passes an AppError(400).
   */
  (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[where], { abortEarly: false, stripUnknown: true });
    if (error) return next(new AppError(error.details.map((d) => d.message).join(', '), 400));
    if (where === 'body') req.body = value;
    if (where === 'query') res.locals.query = value;
    next();
  };