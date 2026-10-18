import { app } from './src/app.js';
import { env } from './src/config/env.js';
import { prisma } from './src/config/prisma.js';
import { redis } from './src/config/redis.js';
import { logger } from './src/utils/logger.js';

/**
 * server.ts
 * STEP 1: Connect to the database first. If it fails, the service must not start.
 * STEP 2: Start the HTTP server.
 * STEP 3: On Ctrl+C or docker stop, close the server, database and Redis cleanly.
 * (The BullMQ worker is started here in Step 10.6.)
 */
async function main() {
  await prisma.$connect();

  const server = app.listen(env.port, () => {
    logger.info(`recording-service listening on port ${env.port}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down recording-service');
    server.close();
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