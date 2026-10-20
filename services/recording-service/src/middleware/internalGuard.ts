import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { AppError } from '../utils/AppError.ts';

/**
 * internalGuard (for the SFU only)
 *
 * STEP 1: Hash both secrets with SHA-256. The hashes always have the same length,
 *         which timingSafeEqual requires.
 * STEP 2: timingSafeEqual compares in constant time, so an attacker cannot guess
 *         the secret from response times.
 */
const hash = (value: string) => createHash('sha256').update(value).digest();
const expected = hash(env.internalSecret);

export function internalGuard(req: Request, _res: Response, next: NextFunction) {
  const provided = req.header('x-internal-secret');
  if (!provided || !timingSafeEqual(hash(provided), expected)) {
    return next(new AppError('Unauthorized', 401));
  }
  next();
}