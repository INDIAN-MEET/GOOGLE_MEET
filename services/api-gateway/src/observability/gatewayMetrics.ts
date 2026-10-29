// services/api-gateway/src/observability/gatewayMetrics.ts

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import client from 'prom-client';
import { register } from './metrics.js';

/** Fixed list of public route prefixes. Anything else is labelled "unmatched". */
const KNOWN_PREFIXES = [
  '/api/auth',
  '/api/users',
  '/api/v1/rooms',
  '/api/v1/chat',
  '/api/v1/recordings',
  '/api/v1/notifications',
  '/health',
  '/ready',
] as const;

/** Counts proxy failures (upstream down, timeout) by target service and status. */
export const proxyErrorsTotal = new client.Counter({
  name: 'gateway_proxy_errors_total',
  help: 'Upstream proxy failures turned into 502/504 by the gateway',
  labelNames: ['target', 'status'] as const,
  registers: [register],
});

/** Counts requests rejected by each rate limiter. */
export const rateLimitHitsTotal = new client.Counter({
  name: 'gateway_rate_limit_hits_total',
  help: 'Requests rejected with 429 by the gateway rate limiters',
  labelNames: ['limiter'] as const,
  registers: [register],
});

/**
 * Maps a request URL to a safe, low-cardinality route label.
 *
 * @param req - the Express request
 * @returns a known prefix, or "unmatched"
 * @throws {Error} never.
 */
export function resolveGatewayRoute(req: Request): string {
  const url = req.originalUrl ?? req.url;
  const found = KNOWN_PREFIXES.find((prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`));
  return found ?? 'unmatched';
}

/**
 * Builds a rate-limit "handler" for express-rate-limit that counts the hit and replies with 429.
 * Use it as the `handler` option of each limiter.
 *
 * @param limiterName - short name such as "global", "auth", "refresh", "api", "download"
 * @returns an Express handler that answers 429 in the project's JSON shape
 * @throws {Error} never.
 */
export function rateLimitHandler(limiterName: string): RequestHandler {
  return function onRateLimited(req: Request, res: Response, _next: NextFunction): void {
    rateLimitHitsTotal.inc({ limiter: limiterName });
    const requestId = req.headers['x-request-id'] ?? null;
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.',
      requestId,
    });
  };
}

