import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.ts';

/**
 * queues.ts
 *
 * STEP 1: BullMQ needs maxRetriesPerRequest: null on its Redis connection.
 * STEP 2: attempts 3 + exponential backoff = temporary errors are retried.
 * STEP 3: Job id "finalize-<id>" means a duplicate webhook cannot create a second job.
 */
export const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

export const finalizeQueue = new Queue('recording-finalize', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

const ACTIVE_STATES = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'];

/**
 * Queues the finalize job for a recording. A duplicate id is ignored by BullMQ.
 *
 * @param recordingId - Recording to finalize.
 * @returns A promise resolving to the BullMQ job.
 */
export function enqueueFinalize(recordingId: string) {
  return finalizeQueue.add('finalize', { recordingId }, { jobId: `finalize-${recordingId}` });
}

/**
 * Looks up the BullMQ state of a recording's finalize job.
 *
 * @param recordingId - Recording id.
 * @returns A promise resolving to the job state ("active", "waiting", "failed", ...) or "missing".
 */
export async function getFinalizeJobState(recordingId: string): Promise<string> {
  const job = await finalizeQueue.getJob(`finalize-${recordingId}`);
  return job ? job.getState() : 'missing';
}

/**
 * Tells whether a finalize job state means "work is still going to happen".
 *
 * @param state - Value returned by getFinalizeJobState.
 * @returns True for active, waiting, delayed, prioritized, or waiting-children.
 */
export function isJobInFlight(state: string): boolean {
  return ACTIVE_STATES.includes(state);
}

/**
 * Queues a finalize job again, even if an old completed or failed job with the same id remains.
 * A job that is still in flight is left alone.
 *
 * @param recordingId - Recording to re-run.
 * @returns A promise resolving to `{ queued, state }` where state is the previous job state.
 * @throws Error when Redis is unavailable.
 */
export async function requeueFinalize(recordingId: string): Promise<{ queued: boolean; state: string }> {
  const jobId = `finalize-${recordingId}`;
  const existing = await finalizeQueue.getJob(jobId);
  let state = 'missing';
  if (existing) {
    state = await existing.getState();
    if (isJobInFlight(state)) return { queued: false, state };
    await existing.remove();
  }
  await finalizeQueue.add('finalize', { recordingId }, { jobId });
  return { queued: true, state };
}

/**
 * Closes the finalize queue and the shared Redis connection (call last during shutdown).
 *
 * @returns A promise that resolves when both are closed.
 */
export async function closeQueues(): Promise<void> {
  await finalizeQueue.close();
  await connection.quit();
}
