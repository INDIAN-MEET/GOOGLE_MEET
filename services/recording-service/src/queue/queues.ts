import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.ts';

/**
 * queues.ts
 *
 * STEP 1: BullMQ needs maxRetriesPerRequest: null on its Redis connection.
 * STEP 2: attempts 3 + exponential backoff = temporary errors are retried.
 * STEP 3: enqueueFinalize uses jobId "finalize-<id>", so a duplicate webhook
 *         cannot create a second job.
 * The worker that runs these jobs is written in Step 10.6.
 */

export const connection  = new Redis(env.redisUrl,{maxRetriesPerRequest: null});


export const finalizeQueue = new Queue('recording-finalize', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export function enqueueFinalize(recordingId: string) {
  return finalizeQueue.add('finalize', { recordingId }, { jobId: `finalize-${recordingId}` });
}
