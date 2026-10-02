import type { Request, Response, NextFunction } from 'express';
import type Joi from 'joi';
import AppError from '../utils/AppError.ts';

/**
 * validate(schema, source)
 *
 * STEP 1: Return a middleware bound to one schema and one request
 *         part ("body", "params" or "query").
 *
 * STEP 2: Validate that part. Stop at the first error (abortEarly)
 *         and allow unknown extra keys (allowUnknown), so a client
 *         that adds a harmless field is not rejected.
 *
 * STEP 3: On error, send AppError 400 with Joi's message
 *         with the quote marks removed, e.g. "direction must be one of [send, recv]".
 *
 * STEP 4: On success, call next(). We do NOT overwrite req.query,
 *         because it is read-only in Express 5.
 */
export function validate(schema: Joi.ObjectSchema, source: 'body' | 'params' | 'query' = 'body') {
    return (req: Request, _res: Response, next: NextFunction) => {
        // STEP 2
        const { error } = schema.validate(req[source], { abortEarly: true, allowUnknown: true });

        // STEP 3
        if (error) {
            const message = error.details[0]?.message.replace(/"/g, '') ?? 'Invalid request';
            return next(new AppError(message, 400));
        }

        // STEP 4
        next();
    };
}