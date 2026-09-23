import * as mediasoup from 'mediasoup';
import { mediasoupConfig } from '../config/mediasoup.ts';
import {logger} from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';

const workers: mediasoup.types.Worker[] = [];
let nextIndex = 0;

async function createWorkers(): Promise<void> {
    for (let i = 0; i < mediasoupConfig.numWorkers; i++) {
        const worker = await mediasoup.createWorker(mediasoupConfig.worker);

        worker.on('died', () => {
            logger.error({ pid: worker.pid }, 'Mediasoup Worker died, exiting');
            setTimeout(() => process.exit(1), 2000);
        })

        workers.push(worker);
        logger.info({ pid: worker.pid }, 'Mediasoup Worker created');
    }
}

export function getNextWorker(): mediasoup.types.Worker {
  if (workers.length === 0) {
    logger.error('No mediasoup workers available');

    throw new AppError(
      'No mediasoup workers available',
      500
    );
  }

  const worker = workers[nextIndex]!;

  nextIndex = (nextIndex + 1) % workers.length;

  return worker;
}