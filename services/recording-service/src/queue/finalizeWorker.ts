import { Worker, UnrecoverableError, type Job } from 'bullmq';
import { env } from '../config/env.ts';
import { connection } from './queues.ts';
import { finalizeRecording, markRecordingFailed, type FinalizeResult } from '../processing/finalizeRecording.ts';
import { UUID_RE } from '../storage/paths.ts';
import { logger } from '../utils/logger.ts';

interface FinalizeJobData {
  recordingId: string;
}

let worker: Worker<FinalizeJobData, FinalizeResult> | null = null;

/**
 * BullMQ processor: runs finalizeRecording for one job.
 *
 * @param job - Queued job holding `{ recordingId }`.
 * @returns A promise resolving to the finalize result (stored by BullMQ as the return value).
 * @throws UnrecoverableError for bad data (no retry); any other error triggers a retry.
 */
const processFinalizeJob = async (job: Job<FinalizeJobData, FinalizeResult>): Promise<FinalizeResult> => {
  const { recordingId } = job.data;
  if (!UUID_RE.test(String(recordingId))) throw new UnrecoverableError('Invalid recordingId');
  logger.info({ jobId: job.id, recordingId, attempt: job.attemptsMade + 1 }, 'Processing finalize job');

  /**
   * Reports progress to BullMQ so it can be inspected in Redis.
   *
   * @param percent - Progress from 0 to 100.
   * @returns A promise that resolves when the progress is stored.
   */
  const reportProgress = async (percent: number): Promise<void> => {
    await job.updateProgress(percent);
  };
  return finalizeRecording(recordingId, reportProgress);
};

/**
 * Logs a successful job.
 *
 * @param job - The completed job.
 * @param result - Value returned by the processor.
 */
function onCompleted(job: Job<FinalizeJobData, FinalizeResult>, result: FinalizeResult): void {
  logger.info({ jobId: job.id, result }, 'Finalize job completed');
}

/**
 * Handles a failed attempt. The recording is marked FAILED only on the FINAL attempt
 * (retries exhausted) or when the error is unrecoverable, so a retry never fails it early,
 * and "recording-failed" is published once.
 *
 * @param job - The failed job (undefined if BullMQ lost it).
 * @param err - The error that failed the attempt.
 * @returns A promise that resolves when the failure was handled (never rejects).
 */
async function onFailed(job: Job<FinalizeJobData, FinalizeResult> | undefined, err: Error): Promise<void> {
  const recordingId = job?.data?.recordingId;
  if (!job || !recordingId) {
    logger.error({ err }, 'A finalize job failed without data');
    return;
  }
  const maxAttempts = job.opts.attempts ?? 1;
  const isFinal = err instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;
  if (!isFinal) {
    logger.warn({ jobId: job.id, recordingId, attemptsMade: job.attemptsMade, maxAttempts, error: err.message }, 'Finalize attempt failed, will retry');
    return;
  }
  try {
    await markRecordingFailed(recordingId, err.message);
  } catch (markErr) {
    logger.error({ markErr, recordingId }, 'Could not mark recording FAILED (recovery will retry)');
  }
}

/**
 * Logs worker-level errors such as Redis disconnects (BullMQ reconnects by itself).
 *
 * @param err - The worker error.
 */
function onWorkerError(err: Error): void {
  logger.error({ err }, 'Finalize worker error');
}

/**
 * Logs a stalled job (the worker died or lost its lock). BullMQ re-queues it automatically.
 *
 * @param jobId - Id of the stalled job.
 */
function onStalled(jobId: string): void {
  logger.warn({ jobId }, 'Finalize job stalled, it will be retried');
}

/**
 * Starts the single finalize worker. Calling it again returns the same worker.
 * Concurrency is FINALIZE_CONCURRENCY (default 1) because transcoding is CPU heavy.
 *
 * @returns The running BullMQ worker.
 */
export function startFinalizeWorker(): Worker<FinalizeJobData, FinalizeResult> {
  if (worker) return worker;
  worker = new Worker<FinalizeJobData, FinalizeResult>('recording-finalize', processFinalizeJob, {
    connection,
    concurrency: env.finalizeConcurrency,
    lockDuration: 60_000,
  });
  worker.on('completed', onCompleted);
  worker.on('failed', onFailed);
  worker.on('error', onWorkerError);
  worker.on('stalled', onStalled);
  logger.info({ concurrency: env.finalizeConcurrency }, 'Finalize worker started');
  return worker;
}

/**
 * Stops the worker gracefully: it waits for the running job to finish.
 *
 * @returns A promise that resolves when the worker is closed.
 */
export async function stopFinalizeWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
  logger.info('Finalize worker stopped');
}
