import type { NextFunction, Request, Response } from "express";
import type { ObjectSchema } from "joi";
import { AppError } from "../utils/AppError.ts";

/**
 * Build a middleware that validates `req.body` against a Joi schema.
 * Unknown keys are stripped and values are normalised (trimmed, lower-cased...).
 *
 * @param schema Joi schema describing the allowed body.
 * @returns Express middleware that replaces `req.body` with the cleaned value.
 * @throws AppError 400 listing every validation problem.
 */
export function validateBody(schema: ObjectSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { value, error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return next(new AppError(error.details.map((d) => d.message).join("; "), 400));
    }
    req.body = value;
    next();
  };
}