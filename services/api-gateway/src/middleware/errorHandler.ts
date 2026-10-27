import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';
import { IS_PRODUCTION } from '../config/env.js';

/** Shape of errors thrown by body-parser and similar libraries. */
interface HttpLikeError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

/**
 * Reads the request ID set by the `requestId` middleware.
 *
 * @param req - Express request.
 * @returns The request ID, or `undefined`.
 */
const getRequestId = (req: Request): string | undefined => {
  const value = req.headers['x-request-id'];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Central Express error handler. Register it after all routes.
 * Unknown errors become a generic 500 and are only logged, never sent to the client.
 *
 * @param err  - The error passed to `next(err)` or thrown.
 * @param req  - Express request.
 * @param res  - Express response.
 * @param next - Used only when the response already started.
 */
export const errorHandler = (
  err: HttpLikeError,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    return next(err);
  }

  const requestId = getRequestId(req);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: err.message, requestId });
    return;
  }

  if (err.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'Request body is too large', requestId });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: 'Invalid JSON body', requestId });
    return;
  }
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    res.status(415).json({ success: false, error: 'Unsupported content encoding', requestId });
    return;
  }

  const status = err.status ?? err.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ success: false, error: 'Bad request', requestId });
    return;
  }

  logger.error({ err, path: req.path, method: req.method, requestId }, 'Unhandled error');

  const body: Record<string, unknown> = {
    success: false,
    error: 'Internal server error',
    requestId,
  };
  if (!IS_PRODUCTION) {
    body.debug = { message: err.message, stack: err.stack };
  }

  res.status(500).json(body);
};