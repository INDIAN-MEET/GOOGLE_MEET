import { app } from './src/app.ts';
import { env } from './src/config/env.ts';
import { prisma } from './src/config/prisma.ts';
import { redis } from './src/config/redis.ts';
import { startMaintenance, stopMaintenance } from './src/maintenance/scheduler.ts';
import { closeAutoStop, startAutoStopWorker } from './src/queue/autoStop.ts';
import { startFinalizeWorker, stopFinalizeWorker } from './src/queue/finalizeWorker.ts';
import { closeQueues } from './src/queue/queues.ts';
import { logger } from './src/utils/logger.ts';

/**
 * Boots recording-service.
 *
 * STEP 1: Connect to the database first. If it fails, do not start.
 * STEP 2: Start HTTP, the finalize worker, the auto-stop worker, then maintenance
 *         (which runs boot recovery immediately).
 * STEP 3: On SIGINT/SIGTERM shut down in order: HTTP, timers, workers (waits for the running
 *         job), queues, database, Redis. A 60 second guard forces exit if something hangs.
 *
 * @returns A promise that resolves once the server is listening.
 * @throws Error when the database is unreachable.
 */
async function main(): Promise<void> {
  await prisma.$connect();
  const server = app.listen(env.port, () => {
    logger.info(`recording-service listening on port ${env.port}`);
  });
  startFinalizeWorker();
  startAutoStopWorker();
  startMaintenance();

  let shuttingDown = false;

  /**
   * Graceful shutdown handler for SIGINT and SIGTERM. Runs only once.
   *
   * @returns A promise that resolves just before the process exits.
   */
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down recording-service');
    setTimeout(() => process.exit(1), 60_000).unref();
    server.close();
    stopMaintenance();
    await stopFinalizeWorker();
    await closeAutoStop();
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start recording-service');
  process.exit(1);
});