import { Request, Response, NextFunction } from 'express';
import  AppError  from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  logger.error({ err }, 'Request failed');
  res.status(statusCode).json({ success: false, message: err.message });
}