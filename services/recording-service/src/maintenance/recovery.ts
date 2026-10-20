import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingStatus } from '../config/prisma.ts';
import { captureStatus } from '../config/sfuClient.ts';
import { env } from '../config/env.ts';
import { prisma } from '../config/prisma.ts';
import { getFinalizeJobState, isJobInFlight, requeueFinalize } from '../queue/queues.ts';
import { markRecordingFailed } from '../processing/finalizeRecording.ts';
import { applyCaptureEnded, type CaptureEndedBody } from '../services/captureEnded.ts';
import { requestStop } from '../services/recordingLifecycle.ts';
import { captureEndedSchema } from '../validation/recordingSchemas.ts';
import { AppError } from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

const CAPTURING: RecordingStatus[] = ['RECORDING', 'STOPPING'];

/**
 * Reads and validates `<recordingDir>/<id>/manifest.json` written by the SFU.
 *
 * @param recordingId - Recording id (a UUID from our own database).
 * @returns A promise resolving to the manifest body, or null when missing or invalid.
 */
async function readManifest(recordingId: string): Promise<CaptureEndedBody | null> {
  try {
    const text = await readFile(path.join(path.resolve(env.recordingDir), recordingId, 'manifest.json'), 'utf8');
    const { error, value } = captureEndedSchema.validate(JSON.parse(text), { stripUnknown: true });
    return error ? null : (value as CaptureEndedBody);
  } catch {
    return null;
  }
}

/**
 * Fails rows stuck in STARTING (the service crashed while starting a recording).
 *
 * @param now - Current time in milliseconds.
 * @returns A promise that resolves when all stale rows were handled.
 */
async function recoverStarting(now: number): Promise<void> {
  const stale = await prisma.recording.findMany({
    where: { status: 'STARTING', createdAt: { lt: new Date(now - env.staleStartingSeconds * 1000) } },
  });
  for (const r of stale) await markRecordingFailed(r.id, 'Recording did not start');
}

/**
 * Repairs RECORDING and STOPPING rows by comparing them with the SFU.
 *
 * STEP 1: Over the maximum duration: ask for a stop (safety net for a lost auto-stop job).
 * STEP 2: Ask the SFU. Unreachable: skip and try next round. 404: it has no capture.
 * STEP 3: SFU is still capturing this recording: keep it (STOPPING: repeat the idempotent stop).
 * STEP 4: SFU is not capturing it: use manifest.json if it exists (same code as the webhook),
 *         otherwise mark FAILED ("Capture was lost").
 *
 * @param now - Current time in milliseconds.
 * @returns A promise that resolves when all candidates were handled.
 */
async function recoverCapturing(now: number): Promise<void> {
  const candidates = await prisma.recording.findMany({
    where: { status: { in: CAPTURING }, updatedAt: { lt: new Date(now - env.captureGraceSeconds * 1000) } },
  });

  for (const r of candidates) {
    try {
      const overLimit = now - r.startedAt.getTime() > (env.maxRecordingMinutes + 5) * 60_000;
      if (overLimit && r.status === 'RECORDING') {
        await requestStop(r.id, 'max-duration-recovery');
        continue;
      }

      let active = false;
      let sfuRecordingId: string | undefined;
      try {
        const status = await captureStatus(r.roomCode);
        active = status.active;
        sfuRecordingId = status.recordingId;
      } catch (err) {
        if (!(err instanceof AppError && err.statusCode === 404)) {
          logger.warn({ err, recordingId: r.id }, 'SFU unreachable, recovery postponed');
          continue;
        }
      }

      if (active && sfuRecordingId === r.id) {
        if (r.status === 'STOPPING') await requestStopAgain(r.id, r.roomCode);
        continue;
      }

      const manifest = await readManifest(r.id);
      if (manifest) {
        const outcome = await applyCaptureEnded(r.id, manifest);
        logger.info({ recordingId: r.id, outcome }, 'Recovered recording from manifest');
      } else {
        await markRecordingFailed(r.id, 'Capture was lost');
      }
    } catch (err) {
      logger.error({ err, recordingId: r.id }, 'Capture recovery failed for one recording');
    }
  }
}

/**
 * Repeats the (idempotent) SFU stop for a recording stuck in STOPPING.
 *
 * @param recordingId - Recording id.
 * @param roomCode - Room code used as the SFU room id.
 * @returns A promise that resolves when the request was sent (errors are logged only).
 */
async function requestStopAgain(recordingId: string, roomCode: string): Promise<void> {
  try {
    const { stopCapture } = await import('../config/sfuClient.ts');
    await stopCapture(roomCode, recordingId);
  } catch (err) {
    logger.warn({ err, recordingId }, 'Repeated SFU stop failed');
  }
}

/**
 * Repairs PROCESSING rows whose finalize job is gone or finished without updating the row.
 * A job still waiting or running is never touched. Rows older than MAX_PROCESSING_HOURS
 * are failed, so recovery cannot loop forever.
 *
 * @param now - Current time in milliseconds.
 * @returns A promise that resolves when all stale rows were handled.
 */
async function recoverProcessing(now: number): Promise<void> {
  const stale = await prisma.recording.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: new Date(now - env.staleProcessingMinutes * 60_000) } },
  });
  for (const r of stale) {
    try {
      const state = await getFinalizeJobState(r.id);
      if (isJobInFlight(state)) continue;
      const ageMs = now - (r.stoppedAt ?? r.updatedAt).getTime();
      if (ageMs > env.maxProcessingHours * 3_600_000) {
        await markRecordingFailed(r.id, 'Finalization timed out');
      } else {
        const result = await requeueFinalize(r.id);
        logger.warn({ recordingId: r.id, previousState: state, ...result }, 'Re-queued stale PROCESSING recording');
      }
    } catch (err) {
      logger.error({ err, recordingId: r.id }, 'Processing recovery failed for one recording');
    }
  }
}

/**
 * Runs all recovery passes once (at boot and then periodically).
 *
 * @returns A promise that resolves when every pass finished. Individual failures are logged.
 */
export async function recoverStaleRecordings(): Promise<void> {
  const now = Date.now();
  await recoverStarting(now);
  await recoverCapturing(now);
  await recoverProcessing(now);
}
