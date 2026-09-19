import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../config/env.js';
import AppError from '../utils/AppError.js';

// This is required for Docker's strict ES Module compiler check
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const gatewayAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('No token provided', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as { userId: string };
    req.userId = decoded.userId;
    req.headers['x-user-id'] = decoded.userId; // Forwarded downstream
    next();
  } catch (err) {
    next(new AppError('Invalid or expired token', 401));
  }
};
