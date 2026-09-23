import * as mediasoup from 'mediasoup';
import { mediasoupConfig } from '../config/mediasoup.ts';
import { logger } from '../utils/logger.ts';

const workers: mediasoup.types.Worker[] = [];
let nextIndex = 0;

export async function createWorkers(): Promise<void> {
  for (let i = 0; i < mediasoupConfig.numWorkers; i++) {
    const worker = await mediasoup.createWorker(mediasoupConfig.worker);

    worker.on('died', () => {
      logger.error({ pid: worker.pid }, 'Mediasoup Worker died, exiting');
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
    logger.info({ pid: worker.pid }, 'Mediasoup Worker created');
  }
}

export function getNextWorker(): mediasoup.types.Worker {
  const worker = workers[nextIndex];
  if (!worker) {
    throw new Error('No mediasoup workers available');
  }
  nextIndex = (nextIndex + 1) % workers.length;
  return worker;
}