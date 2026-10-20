import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env.ts';
import { connection } from './queues.ts';
import { requestStop } from '../services/recordingLifecycle.ts';
import { logger } from '../utils/logger.ts';

const autoStopQueue = new Queue('recording-autostop', {
  connection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
});

let worker: Worker<{ recordingId: string }> | null = null;

/**
 * Schedules the maximum-duration stop for a recording (delay = MAX_RECORDING_MINUTES).
 *
 * @param recordingId - Recording to stop later.
 * @returns A promise that resolves when the delayed job is stored.
 * @throws Error when Redis is unavailable.
 */
export async function scheduleAutoStop(recordingId: string): Promise<void> {
  await autoStopQueue.add(
    'autostop',
    { recordingId },
    { jobId: `autostop-${recordingId}`, delay: env.maxRecordingMinutes * 60_000 },
  );
}

/**
 * Removes the delayed auto-stop job when a recording ends earlier. Never throws:
 * a leftover job is harmless because it only acts on recordings still RECORDING.
 *
 * @param recordingId - Recording whose job should be removed.
 * @returns A promise that resolves when the attempt is done.
 */
export async function cancelAutoStop(recordingId: string): Promise<void> {
  try {
    const job = await autoStopQueue.getJob(`autostop-${recordingId}`);
    if (job) await job.remove();
  } catch (err) {
    logger.debug({ err, recordingId }, 'Could not remove auto-stop job');
  }
}

/**
 * BullMQ processor for the auto-stop job.
 *
 * @param job - Job holding `{ recordingId }`.
 * @returns A promise that resolves when the stop was requested or was not needed.
 * @throws Error when the SFU cannot be reached (BullMQ retries it).
 */
const processAutoStop = async (job: Job<{ recordingId: string }>): Promise<void> => {
  const result = await requestStop(job.data.recordingId, 'max-duration');
  logger.info({ recordingId: job.data.recordingId, result }, 'Auto-stop job ran');
};

/**
 * Logs auto-stop worker errors.
 *
 * @param err - Worker error.
 */
function onWorkerError(err: Error): void {
  logger.error({ err }, 'Auto-stop worker error');
}

/**
 * Starts the auto-stop worker (one per process).
 *
 * @returns The running worker.
 */
export function startAutoStopWorker(): Worker<{ recordingId: string }> {
  if (worker) return worker;
  worker = new Worker<{ recordingId: string }>('recording-autostop', processAutoStop, { connection, concurrency: 2 });
  worker.on('error', onWorkerError);
  return worker;
}

/**
 * Closes the auto-stop worker and queue (call before closing the shared Redis connection).
 *
 * @returns A promise that resolves when both are closed.
 */
export async function closeAutoStop(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await autoStopQueue.close();
}
