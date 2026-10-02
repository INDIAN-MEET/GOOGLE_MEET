import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

/**
 * errorHandler(err, req, res, next)
 *
 * STEP 1: If the response was already started, hand the error to
 *         Express' default handler. We cannot send a second response.
 *
 * STEP 2: Work out the status code.
 *         AppError keeps its own code (400, 404, 409...).
 *         Any other error is an unexpected fault, so it becomes 500.
 *
 * STEP 3: Log by severity.
 *         5xx = real server fault -> "error" level with the full stack.
 *         4xx = client mistake (bad input, duplicate) -> "warn" level,
 *         no stack, so expected failures do not flood the error logs.
 *
 * STEP 4: Pick the message for the client.
 *         AppError messages are written to be safe, so we send them.
 *         Unknown errors may contain internal details, so we send a
 *         generic message instead (the real one is in the log).
 *
 * STEP 5: Send the JSON response { success: false, message }.
 *
 * @param {Error} err - Error passed with next(err) or thrown in a handler.
 * @param {Request} req - Used only to log the method and URL.
 * @param {Response} res - Used to send the JSON error.
 * @param {NextFunction} next - Used when headers were already sent.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // STEP 1
  if (res.headersSent) {
    next(err);
    return;
  }

  // STEP 2
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;

  // STEP 3
  if (statusCode >= 500) {
    logger.error(
      { err, method: req.method, url: req.originalUrl },
      'Request failed',
    );
  } else {
    logger.warn(
      { statusCode, method: req.method, url: req.originalUrl, message: err.message },
      'Request rejected',
    );
  }

  // STEP 4
  const message = isAppError ? err.message : 'Internal server error';

  // STEP 5
  res.status(statusCode).json({ success: false, message });
}