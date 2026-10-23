import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.ts";
import { AppError } from "../utils/AppError.ts";
import { logger } from "../utils/logger.ts";

/**
 * 404 handler for unknown routes. Mount it AFTER all routes.
 */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("Route not found", 404));
}

/**
 * Global error handler. Mount it LAST.
 * Known AppErrors keep their message and status. Anything else is logged
 * in full but returned to the client as a generic 500 (no stack leaks).
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    success: false,
    message: env.isProd ? "Internal server error" : String((err as Error)?.message ?? err),
  });
}