import type { Request, Response } from 'express';

/**
 * Handles any request that no route matched, returning JSON instead of Express's HTML page.
 * Register it after all routes and before `errorHandler`.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export const notFound = (req: Request, res: Response): void => {
  const value = req.headers['x-request-id'];
  const requestId = Array.isArray(value) ? value[0] : value;
  res.status(404).json({ success: false, error: 'Route not found', requestId });
};