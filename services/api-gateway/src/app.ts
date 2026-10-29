import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import proxyRoutes from './routes/proxyRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { requestId, stripSpoofedHeaders } from './middleware/requestContext.js';
import {
  globalLimiter,
  loginLimiter,
  signupLimiter,
  refreshLimiter,
} from './middleware/rateLimiters.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { FRONTEND_ORIGINS, TRUST_PROXY, BODY_LIMIT } from './config/env.js';
import logger from './utils/logger.js';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';
import { resolveGatewayRoute } from './observability/gatewayMetrics.js';

const app = express();

// 0. How many proxies are in front (affects req.ip, used by rate limiting).
app.set('trust proxy', TRUST_PROXY);

// 1. Request ID first, so even rejected requests are traceable.
app.use(requestId);

// 2. Delete identity headers a client must never control.
app.use(stripSpoofedHeaders);

// 3. Access logs with the request ID. Probes are not logged.
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] as string,
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/ready' || req.url === '/metrics',
    },
  }),
);

// Observability metrics: measures every request
app.use(httpMetricsMiddleware({ resolveRoute: resolveGatewayRoute }));
// Scrapes are never rate limited, so mount BEFORE global limiter
app.get('/metrics', metricsHandler);

// 4. Security headers. cross-origin lets the frontend load recordings from the gateway.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// 5. CORS before rate limiting, so 429 responses carry CORS headers.
app.use(
  cors({
    origin: FRONTEND_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Range'],
    exposedHeaders: [
      'Retry-After',
      'RateLimit',
      'RateLimit-Policy',
      'X-Request-Id',
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
    ],
    maxAge: 600,
  }),
);

// 6. Health probes: never rate limited.
app.use(healthRoutes);

// 7. Global flood protection (per IP).
app.use(globalLimiter);

// 8. Strict auth limiters, BEFORE the body is parsed.
app.post('/api/auth/login', loginLimiter);
app.post('/api/auth/signup', signupLimiter);
app.post('/api/auth/refresh', refreshLimiter);

// 9. Parse JSON with a size limit (413 too large, 400 invalid JSON).
app.use(express.json({ limit: BODY_LIMIT }));

// 10. Proxied API routes.
app.use('/api', proxyRoutes);

// 11. Unknown routes, then the central error handler.
app.use(notFound);
app.use(errorHandler);

export default app;