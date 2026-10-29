// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';

import  app  from './src/app.ts';
import { env } from './src/config/env.ts';
import { logger } from './src/utils/logger.ts';
import { createWorkers, getWorkerCount } from './src/mediasoup/workerPool.ts';
import { getRouterCount } from './src/mediasoup/roomManager.ts';
import { getPeerStats } from './src/mediasoup/peerManager.ts';
import { registerSfuStatsProvider } from './src/observability/sfuMetrics.js';

async function main() {
  await createWorkers();

  registerSfuStatsProvider(() => {
    const peerStats = getPeerStats();
    return {
      workers: getWorkerCount(),
      routers: getRouterCount(),
      transports: peerStats.transports,
      producers: peerStats.producers,
      consumers: peerStats.consumers,
    };
  });

  app.listen(env.port, () => {
    logger.info(`SFU service running on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start SFU service');
  process.exit(1);
});