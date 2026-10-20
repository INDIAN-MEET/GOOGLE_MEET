import { randomUUID } from 'node:crypto';
import { env } from '../config/env.ts';
import { redis } from '../config/redis.ts';
import { logger } from '../utils/logger.ts';
import { runCleanup } from './cleanup.ts';
import { enforceDiskPolicy } from './diskGuard.ts';
import { recoverStaleRecordings } from './recovery.ts';

const timers: NodeJS.Timeout[] = [];

/**
 * Runs a task only if no other recording-service instance is running it right now
 * (a short Redis lock), and never lets an error escape.
 *
 * @param name - Task name (used in the lock key and logs).
 * @param ttlSeconds - Lock lifetime; must be longer than a normal run.
 * @param task - Async function to run.
 * @returns A promise that resolves when the task finished or was skipped.
 */
async function runExclusive(name: string, ttlSeconds: number, task: () => Promise<void>): Promise<void> {
  const key = `recording:maintenance:${name}`;
  const token = randomUUID();
  try {
    if ((await redis.set(key, token, 'EX', ttlSeconds, 'NX')) !== 'OK') return;
    await task();
  } catch (err) {
    logger.error({ err, task: name }, 'Maintenance task failed');
  } finally {
    try {
      if ((await redis.get(key)) === token) await redis.del(key);
    } catch {
      // the lock expires on its own
    }
  }
}

/**
 * Runs recovery and the disk policy once.
 *
 * @returns A promise that resolves when both finished.
 */
async function runRecoveryAndDisk(): Promise<void> {
  await runExclusive('recovery', 240, recoverStaleRecordings);
  await runExclusive('disk', 60, enforceDiskPolicy);
}

/**
 * Starts the maintenance timers and runs recovery once immediately (boot recovery).
 *
 * @returns Nothing. Timers are cleared by stopMaintenance().
 */
export function startMaintenance(): void {
  void runRecoveryAndDisk();
  timers.push(setInterval(() => void runRecoveryAndDisk(), env.maintenanceIntervalMinutes * 60_000));
  timers.push(setInterval(() => void runExclusive('cleanup', 1800, runCleanup), env.cleanupIntervalMinutes * 60_000));
  logger.info('Maintenance scheduler started');
}

/**
 * Stops all maintenance timers.
 *
 * @returns Nothing.
 */
export function stopMaintenance(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
