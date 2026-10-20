import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.ts';
import { redis } from '../config/redis.ts';
import { getDiskStatus } from '../maintenance/diskGuard.ts';

/**
 * GET /ready : readiness. The database and Redis must work (503 otherwise). Disk space is
 * reported as a level and percentage only, with no paths. A critical disk makes the status
 * "degraded" (new recordings are refused) but does not make the service unready.
 *
 * @param _req - Unused request.
 * @param res - Response with the check results.
 * @returns A promise that resolves after the response is sent.
 */
export async function readiness(_req: Request, res: Response): Promise<void> {
  const [database, cache, disk] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
    getDiskStatus(),
  ]);
  const dbOk = database.status === 'fulfilled';
  const redisOk = cache.status === 'fulfilled';
  const storage = disk.status === 'fulfilled' ? { level: disk.value.level, freePercent: disk.value.freePercent } : { level: 'unavailable' };

  const ready = dbOk && redisOk;
  const degraded = storage.level === 'critical' || storage.level === 'unavailable';
  res.status(ready ? 200 : 503).json({
    status: !ready ? 'unready' : degraded ? 'degraded' : 'ok',
    checks: { database: dbOk, redis: redisOk, storage },
  });
}
