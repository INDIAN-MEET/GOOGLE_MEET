import type { NextFunction, Request, Response } from 'express';

/**
 * asyncHandler(fn)
 * Express does not catch errors thrown inside async functions (in Express 4).
 * This wrapper sends any error to the errorHandler, so you never get a hanging request.
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((error) => {
      next(error);
    });
  };
};