import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

/**
 * Verify the `Authorization: Bearer <jwt>` header.
 * On success sets `req.userId` and `req.accessToken`.
 *
 * @throws AppError 401 when the header is missing or the token is invalid/expired.
 */
export function authGuard(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("Missing bearer token", 401));
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as jwt.JwtPayload;
    const userId = (payload.userId ?? payload.sub) as string | undefined; // (A2)
    if (!userId) return next(new AppError("Invalid token payload", 401));

    req.userId = userId ;
    req.accessToken = token;
    next();
  } catch {
    next(new AppError("Invalid or expired token", 401));
  }
}