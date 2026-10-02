import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.ts';
import { env } from '../config/env.ts';

/**
 * authGuard(req, res, next)
 *
 * STEP 1: Hash the expected secret once at startup (SHA-256).
 *         Hashing gives both sides the same length, which
 *         timingSafeEqual requires, and leaks no length information.
 *
 * STEP 2: Read the x-internal-secret header.
 *         Missing or not a string -> 401.
 *
 * STEP 3: Hash the received value and compare with timingSafeEqual.
 *         A normal === compare can leak the secret through timing.
 *
 * STEP 4: Mismatch -> 401 "Unauthorized" (same message for missing
 *         and wrong, so an attacker learns nothing).
 *         Match -> next().
 */

const expectedHash = crypto.createHash('sha256').update(env.internalSecret).digest(); // STEP 1

export function authGuard(req: Request, _res: Response, next: NextFunction) {
  // STEP 2
  const header = req.header('x-internal-secret');
  if (typeof header !== 'string' || header.length === 0) {
    return next(new AppError('Unauthorized', 401));
  }

  // STEP 3
  const receivedHash = crypto.createHash('sha256').update(header).digest();
  const ok = crypto.timingSafeEqual(receivedHash, expectedHash);

  // STEP 4
  if (!ok) return next(new AppError('Unauthorized', 401));
  next();
}