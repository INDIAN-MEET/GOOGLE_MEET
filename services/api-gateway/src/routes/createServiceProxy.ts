import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import logger from '../utils/logger.js';

/** Error codes meaning "the service cannot be reached" (502). */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ECONNRESET',
  'EAI_AGAIN',
  'EPIPE',
]);

/** Error codes meaning "the service took too long" (504). */
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Result of {@link classifyProxyError}. */
export interface ProxyFailure {
  /** HTTP status for the client. */
  status: 502 | 504;
  /** Safe message with no internal details. */
  message: string;
}

/**
 * Converts a low-level network error into a safe HTTP response description.
 *
 * @param err - Error from the proxy library.
 * @returns Status and a client-safe message. Unknown errors become 502.
 */
export function classifyProxyError(err: NodeJS.ErrnoException): ProxyFailure {
  const code = err.code ?? '';
  const looksLikeTimeout = TIMEOUT_CODES.has(code) || /timed? ?out/i.test(err.message ?? '');

  if (looksLikeTimeout) {
    return { status: 504, message: 'Upstream service timed out' };
  }
  if (UNREACHABLE_CODES.has(code)) {
    return { status: 502, message: 'Service temporarily unavailable' };
  }
  return { status: 502, message: 'Service temporarily unavailable' };
}

/** Options for {@link createServiceProxy}. */
export interface ServiceProxyOptions {
  /** Short name used only in logs, e.g. "chat-service". */
  name: string;
  /** Base URL of the service. */
  target: string;
  /** Which incoming paths this proxy handles. */
  pathFilter?: string | string[];
  /** Regex -> replacement map applied before forwarding. */
  pathRewrite?: Record<string, string>;
  /** Max wait for the service in ms. Default 15000. */
  timeoutMs?: number;
}

/**
 * Creates a reverse proxy to one service with the gateway's standard settings:
 * changeOrigin, fixRequestBody, timeouts, and a sanitized 502/504 error trap.
 *
 * @param options - See {@link ServiceProxyOptions}.
 * @returns An Express-compatible middleware.
 */
export function createServiceProxy(options: ServiceProxyOptions) {
  const { name, target, pathFilter, pathRewrite, timeoutMs = 15_000 } = options;

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter,
    pathRewrite,
    timeout: timeoutMs,
    proxyTimeout: timeoutMs,
    on: {
      proxyReq: fixRequestBody,

      /**
       * Called when the request to the service fails.
       * The real error goes to the log only. The client gets a generic JSON error.
       *
       * @param err - The network error.
       * @param req - Incoming request.
       * @param res - ServerResponse, or a Socket for WebSocket upgrades.
       */
      error: (err: Error, req: IncomingMessage, res: ServerResponse | Socket) => {
        const requestId = req.headers['x-request-id'];

        logger.error(
          {
            err: err.message,
            code: (err as NodeJS.ErrnoException).code,
            service: name,
            target,
            path: req.url,
            requestId,
          },
          'Proxy error',
        );

        if (!('writeHead' in res)) {
          res.destroy();
          return;
        }

        if (res.headersSent) {
          res.end();
          return;
        }

        const failure = classifyProxyError(err as NodeJS.ErrnoException);

        res.writeHead(failure.status, {
          'Content-Type': 'application/json',
          'Retry-After': '5',
        });
        res.end(JSON.stringify({ success: false, error: failure.message, requestId }));
      },
    },
  });
}