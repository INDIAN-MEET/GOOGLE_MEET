import { Router } from 'express';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Liveness probe. Only proves the process is running. Never checks Redis.
 *
 * @returns 200 `{ status: "ok", service: "api-gateway" }`
 */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

/**
 * Readiness probe. Checks that Redis answers a PING.
 *
 * @returns 200 `{ status: "ready" }` or 503 `{ status: "not-ready", reason: "redis" }`
 */
router.get('/ready', async (_req, res) => {
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error(`Unexpected PING reply: ${pong}`);
    res.json({ status: 'ready', service: 'api-gateway' });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Readiness check failed');
    res.status(503).json({ status: 'not-ready', reason: 'redis' });
  }
});

export default router;