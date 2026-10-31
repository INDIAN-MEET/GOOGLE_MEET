import { Router } from 'express';
import { gatewayAuth } from '../middleware/gatewayAuth.js';
import { standardLimiter, recordingsLimiter, downloadLimiter } from '../middleware/rateLimiters.js';
import { createServiceProxy } from './createServiceProxy.js';
import {
  AUTH_SERVICE_URL,
  USER_SERVICE_URL,
  ROOM_SERVICE_URL,
  CHAT_SERVICE_URL,
  RECORDING_SERVICE_URL,
  NOTIFICATION_SERVICE_URL,
} from '../config/env.js';

/**
 * All proxied HTTP routes, mounted at `/api` in app.ts.
 * Login/signup/refresh limits are applied in app.ts, before the body is parsed.
 * Protected routes run: gatewayAuth -> limiter -> proxy.
 */
const router = Router();

// Auth service: PUBLIC routes
router.use(
  createServiceProxy({
    name: 'auth-service',
    target: AUTH_SERVICE_URL,
    pathFilter: ['/auth/signup', '/auth/login', '/auth/refresh'],
    pathRewrite: { '^/auth': '/api/v1/auth' },
  }),
);

// Auth service: PROTECTED routes
router.use(
  ['/auth/logout', '/auth/me', '/auth/turn-credentials'],
  gatewayAuth,
  standardLimiter,
);
router.use(
  createServiceProxy({
    name: 'auth-service',
    target: AUTH_SERVICE_URL,
    pathFilter: ['/auth/logout', '/auth/me', '/auth/turn-credentials'],
    pathRewrite: {
      '^/auth/logout': '/api/v1/logout',
      '^/auth': '/api/v1/auth',
    },
  }),
);

// User service
router.use('/users', gatewayAuth, standardLimiter);
router.use(
  createServiceProxy({
    name: 'user-service',
    target: USER_SERVICE_URL,
    pathFilter: '/users',
    pathRewrite: { '^/users': '' },
  }),
);

// Room service
router.use('/v1/rooms', gatewayAuth, standardLimiter);
router.use(
  createServiceProxy({
    name: 'room-service',
    target: ROOM_SERVICE_URL,
    pathFilter: '/v1/rooms',
    pathRewrite: { '^/v1/rooms': '/v1/rooms' },
  }),
);

// Chat service
router.use('/v1/chat', gatewayAuth, standardLimiter);
router.use(
  createServiceProxy({
    name: 'chat-service',
    target: CHAT_SERVICE_URL,
    pathFilter: '/v1/chat',
    pathRewrite: { '^/v1/chat': '/api/v1/chat' },
  }),
);

// Recording service (downloads have their own tier, 10 minute timeout)
router.use('/v1/recordings', gatewayAuth);
router.use('/v1/recordings/:recordingId/download', downloadLimiter);
router.use('/v1/recordings', recordingsLimiter);
router.use(
  createServiceProxy({
    name: 'recording-service',
    target: RECORDING_SERVICE_URL,
    pathFilter: '/v1/recordings',
    pathRewrite: { '^/v1/recordings': '/v1/recordings' },
    timeoutMs: 10 * 60_000,
  }),
);

// Notification service
router.use('/v1/notifications', gatewayAuth, standardLimiter);
router.use(
  createServiceProxy({
    name: 'notification-service',
    target: NOTIFICATION_SERVICE_URL,
    pathFilter: '/v1/notifications',
    pathRewrite: { '^/v1/notifications': '/v1/notifications' },
  }),
);

export default router;