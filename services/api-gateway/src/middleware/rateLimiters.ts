import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';
import redis from '../config/redis.js';
import { RATE_LIMITS } from '../config/env.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/** Body returned for every 429. */
const TOO_MANY_REQUESTS = {
  success: false,
  error: 'Too many requests. Please try again later.',
} as const;

/**
 * Builds a rate-limit key from the client IP (IPv6-safe).
 *
 * @param req - Express request.
 * @returns A string like `ip:203.0.113.5`.
 */
const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`;

/**
 * Builds a rate-limit key from the logged-in user, falling back to the IP.
 *
 * @param req - Express request (needs `req.userId` from `gatewayAuth`).
 * @returns A string like `user:abc123`.
 */
const userKey = (req: Request): string => (req.userId ? `user:${req.userId}` : ipKey(req));

/** Options for {@link buildLimiter}. */
interface LimiterConfig {
  /** Redis key prefix, becomes `rl:<prefix>:`. */
  prefix: string;
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per window. */
  limit: number;
  /** How to identify the caller. */
  keyGenerator: (req: Request) => string;
  /** If true, successful (status < 400) requests are not counted. */
  skipSuccessfulRequests?: boolean;
  /** If true, a Redis failure lets the request through. */
  failOpen: boolean;
  /** Return true to exclude a request from this limiter. */
  skip?: (req: Request) => boolean;
}

/**
 * Creates one Redis-backed rate limiter with the standard 429 response.
 *
 * @param config - See {@link LimiterConfig}.
 * @returns An Express middleware.
 */
function buildLimiter(config: LimiterConfig): RequestHandler {
  const options: Partial<Options> = {
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: config.keyGenerator,
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    skip: config.skip,
    passOnStoreError: config.failOpen,
    store: new RedisStore({
      prefix: `rl:${config.prefix}:`,
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    }),
    handler: (req, res, _next, optionsUsed) => {
      logger.warn(
        {
          tier: config.prefix,
          key: config.keyGenerator(req as Request),
          path: req.originalUrl,
          requestId: req.headers['x-request-id'],
        },
        'Rate limit exceeded',
      );
      res.status(optionsUsed.statusCode).json(TOO_MANY_REQUESTS);
    },
  };

  return rateLimit(options);
}

/**
 * Wraps a limiter so a Redis failure becomes a clean 503 (fail closed).
 *
 * @param limiter - A limiter built with `failOpen: false`.
 * @returns A middleware that converts store errors into `AppError(503)`.
 */
function failClosed(limiter: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    limiter(req, res, (err?: unknown) => {
      if (err) {
        logger.error({ err }, 'Rate limit store unavailable (auth tier failing closed)');
        return next(new AppError('Service temporarily unavailable', 503));
      }
      next();
    });
  };
}

/** Flood protection for everything, per IP. Fails open. */
export const globalLimiter: RequestHandler = buildLimiter({
  prefix: 'global',
  ...RATE_LIMITS.global,
  keyGenerator: ipKey,
  failOpen: true,
});

/** Login: only FAILED attempts count, per IP. Fails closed. */
export const loginLimiter: RequestHandler = failClosed(
  buildLimiter({
    prefix: 'login',
    ...RATE_LIMITS.login,
    keyGenerator: ipKey,
    skipSuccessfulRequests: true,
    failOpen: false,
  }),
);

/** Signup, per IP. Fails closed. */
export const signupLimiter: RequestHandler = failClosed(
  buildLimiter({
    prefix: 'signup',
    ...RATE_LIMITS.signup,
    keyGenerator: ipKey,
    failOpen: false,
  }),
);

/** Token refresh, per IP. Fails closed. */
export const refreshLimiter: RequestHandler = failClosed(
  buildLimiter({
    prefix: 'refresh',
    ...RATE_LIMITS.refresh,
    keyGenerator: ipKey,
    failOpen: false,
  }),
);

/** Normal API calls, per user. Must run after `gatewayAuth`. Fails open. */
export const standardLimiter: RequestHandler = buildLimiter({
  prefix: 'api',
  ...RATE_LIMITS.standard,
  keyGenerator: userKey,
  failOpen: true,
});

/** Same counter as `standardLimiter`, but skips `/download` (it has its own tier). */
export const recordingsLimiter: RequestHandler = buildLimiter({
  prefix: 'api',
  ...RATE_LIMITS.standard,
  keyGenerator: userKey,
  failOpen: true,
  skip: (req) => req.originalUrl.split('?')[0].endsWith('/download'),
});

/**
 * Recording downloads, counted per user AND per recording.
 * Must be mounted on a path containing `:recordingId`.
 */
export const downloadLimiter: RequestHandler = buildLimiter({
  prefix: 'download',
  ...RATE_LIMITS.download,
  keyGenerator: (req) => `${userKey(req)}:rec:${req.params.recordingId ?? 'unknown'}`,
  failOpen: true,
});