import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import { AppError } from '../utils/AppError.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      token?: string;
    }
  }
}

/**
 * authGuard (for normal users)
 *
 * STEP 1: Read "Authorization: Bearer <token>". Missing -> 401.
 * STEP 2: Verify with JWT_ACCESS_SECRET (same secret as auth/signaling/gateway). Bad -> 401.
 * STEP 3: Save userId and the raw token on req. The token is reused to call Room service.
 *
 * CHECK: which field holds the user id in YOUR token? Look at signaling's socketAuth.
 *        Below it tries userId, then sub, then id.
 */
export function authGuard(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(new AppError('Missing token', 401));

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as Record<string, unknown>;
    const userId = (payload.userId ?? payload.sub ?? payload.id) as string | undefined;
    if (!userId) return next(new AppError('Invalid token', 401));
    req.userId = userId;
    req.token = token;
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}