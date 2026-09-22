import { Router } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { gatewayAuth } from '../middleware/gatewayAuth.js';
import { AUTH_SERVICE_URL, USER_SERVICE_URL, ROOM_SERVICE_URL, CHAT_SERVICE_URL } from '../config/env.js';

const router = Router();

// Public — no auth required (signup, login, refresh)
router.use(createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
  pathFilter: ['/auth/signup', '/auth/login', '/auth/refresh'],
  pathRewrite: { '^/auth': '/api/v1/auth' },
  on: { proxyReq: fixRequestBody },
}));

// Protected — requires a valid token at the Gateway
router.use(
  ['/auth/logout', '/auth/me', '/auth/turn-credentials'],
  gatewayAuth,
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/auth': '/api/v1/auth' },
    on: { proxyReq: fixRequestBody },
  })
);

/**  
 * User Service — entirely protected
 */
router.use('/users', gatewayAuth);

router.use(createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathFilter: '/users',
    pathRewrite: { '^/users': '' },
    on: { proxyReq: fixRequestBody },
}));

/**
 * Room Service — entirely protected
 * room-service mounts its routes at '/v1' (app.use('/v1', roomRoutes)),
 * so its real routes are /v1/rooms, /v1/rooms/:code, etc.
 * Client calls /api/v1/rooms/* — no rewrite needed, path matches as-is.
 */
router.use('/v1/rooms', gatewayAuth);

router.use(createProxyMiddleware({
  target: ROOM_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/v1/rooms',
  pathRewrite: { '^/v1/rooms': '/v1/rooms' },
  on: { proxyReq: fixRequestBody },
}));

// Chat Service — entirely protected
router.use('/v1/chat', gatewayAuth);

router.use(createProxyMiddleware({
    target: CHAT_SERVICE_URL,
    changeOrigin: true,
    pathFilter: '/v1/chat',
    pathRewrite: { '^/v1/chat': '/api/v1/chat' },
    on: { proxyReq: fixRequestBody },
}));

export default router;