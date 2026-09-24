import { app } from './src/app.ts';
import { env } from './src/config/env.ts';
import { logger } from './src/utils/logger.ts';
import { createWorkers } from './src/mediasoup/workerPool.ts';

async function main() {
  await createWorkers();

  app.listen(env.port, () => {
    logger.info(`SFU service running on port https://localhost:${env.port}`);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start SFU service');
  process.exit(1);
});