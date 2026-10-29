// shared/observability/metrics.ts
// Copied into services/<name>/src/observability/metrics.ts by Step 13.6.

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
// prom-client is CommonJS: use the default import, then read members from it.
import client from 'prom-client';
import { observabilityConfig } from './config.js';

/**
 * Options for {@link httpMetricsMiddleware}.
 */
export interface HttpMetricsOptions {
  /**
   * Optional function that turns a request into a SAFE, low-cardinality route label.
   * Return undefined to fall back to the Express route pattern.
   */
  resolveRoute?: (req: Request) => string | undefined;
}

/** One registry per process. We do not use the global registry so tests stay isolated. */
export const register = new client.Registry();

if (observabilityConfig.metricsEnabled) {
  // Gives us process_cpu_*, process_resident_memory_bytes, nodejs_eventloop_lag_*, GC stats, etc.
  client.collectDefaultMetrics({ register });
}

/** Histogram of HTTP request durations. Its _count series doubles as a request counter. */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // Buckets tuned for an API: 5 ms up to 10 s. bcrypt logins land around 0.1-0.3 s.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/** Number of HTTP requests currently being processed. */
export const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  registers: [register],
});

/**
 * Builds the safe route label for a finished request.
 *
 * @param req - the Express request
 * @param options - optional custom resolver
 * @returns a low-cardinality label such as "/v1/rooms/:code" or "unmatched"
 */
function routeLabel(req: Request, options: HttpMetricsOptions): string {
  const custom = options.resolveRoute?.(req);
  if (custom !== undefined) return custom;
  // req.route only exists when a real Express route matched, so 404 scans do not create labels.
  if (req.route && typeof req.route.path === 'string') {
    return `${req.baseUrl ?? ''}${req.route.path}`;
  }
  return 'unmatched';
}

/**
 * Express middleware that measures every request's duration and status code.
 * Mount it early (right after the request-id / logging middleware).
 *
 * @param options - optional route resolver (the Gateway uses this)
 * @returns an Express middleware
 */
export function httpMetricsMiddleware(options: HttpMetricsOptions = {}): RequestHandler {
  return function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Do not measure Prometheus scraping itself.
    if (!observabilityConfig.metricsEnabled || req.path === '/metrics') {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    httpRequestsInFlight.inc();

    let finished = false;
    /**
     * Records the request exactly once, even if both "finish" and "close" fire.
     *
     * @returns nothing
     */
    const record = (): void => {
      if (finished) return;
      finished = true;
      httpRequestsInFlight.dec();
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDuration.observe(
        { method: req.method, route: routeLabel(req, options), status_code: String(res.statusCode) },
        seconds,
      );
    };
    res.on('finish', record);
    // "close" covers clients that disconnect before the response ends (otherwise in-flight would leak).
    res.on('close', record);
    next();
  };
}

/**
 * Compares two strings in constant time to avoid timing attacks on the token.
 *
 * @param provided - value sent by the caller
 * @param expected - the real token
 * @returns true when both strings are identical
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on different lengths. Length is not secret enough to matter here.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sends a JSON error in the project's standard shape without leaking internals.
 *
 * @param req - the Express request (used to echo x-request-id)
 * @param res - the Express response
 * @param status - HTTP status code
 * @param code - short machine-readable error code
 * @param message - safe, human-readable message
 * @returns nothing
 */
function sendMetricsError(req: Request, res: Response, status: number, code: string, message: string): void {
  const requestId = req.headers['x-request-id'] ?? null;
  res.status(status).json({ success: false, error: { code, message }, requestId });
}

/**
 * Express handler for GET /metrics. Mount it BEFORE auth guards and rate limiters.
 *
 * @param req - the Express request
 * @param res - the Express response
 * @returns a promise that resolves when the response is sent
 * @throws {Error} never. All errors are caught and converted to a generic 500.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  if (!observabilityConfig.metricsEnabled) {
    sendMetricsError(req, res, 404, 'NOT_FOUND', 'Not found');
    return;
  }

  const expected = observabilityConfig.metricsToken;
  if (expected !== undefined) {
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!tokenMatches(provided, expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendMetricsError(req, res, 401, 'UNAUTHORIZED', 'Unauthorized');
      return;
    }
  }

  try {
    res.setHeader('Content-Type', register.contentType);
    // Never cache metrics: stale data would confuse Prometheus.
    res.setHeader('Cache-Control', 'no-store');
    res.end(await register.metrics());
  } catch {
    sendMetricsError(req, res, 500, 'INTERNAL_ERROR', 'Could not collect metrics');
  }
}