import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** Allowed shape of a client-supplied request ID (prevents log injection). */
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Ensures every request has a safe `x-request-id`.
 * Accepts the client's ID only if valid, otherwise generates a UUID.
 *
 * @param req  - Express request.
 * @param res  - Express response.
 * @param next - Continues to the next middleware.
 */
export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();

  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/**
 * Removes identity headers that only the gateway may set.
 * `gatewayAuth` sets the real `x-user-id` later, after the JWT is verified.
 *
 * @param req  - Express request.
 * @param _res - Unused.
 * @param next - Continues to the next middleware.
 */
export const stripSpoofedHeaders = (req: Request, _res: Response, next: NextFunction): void => {
  delete req.headers['x-user-id'];
  delete req.headers['x-forwarded-user'];
  next();
};