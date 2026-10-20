import { app } from './src/app.ts';
import { env } from './src/config/env.ts';
import { prisma } from './src/config/prisma.ts';
import { redis } from './src/config/redis.ts';
import { closeQueues } from './src/queue/queues.ts';
import { startFinalizeWorker, stopFinalizeWorker } from './src/queue/finalizeWorker.ts';
import { logger } from './src/utils/logger.ts';

/**
 * Boots recording-service.
 *
 * STEP 1: Connect to the database first. If it fails, do not start.
 * STEP 2: Start the HTTP server and the finalize worker (one worker per process).
 * STEP 3: On SIGINT/SIGTERM stop HTTP, wait for the running job, close queues, DB, Redis.
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

  /**
   * Graceful shutdown handler for SIGINT and SIGTERM.
   *
   * @returns A promise that resolves just before the process exits.
   */
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down recording-service');
    server.close();
    await stopFinalizeWorker();
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