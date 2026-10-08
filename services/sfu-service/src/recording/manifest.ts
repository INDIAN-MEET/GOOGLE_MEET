import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

/** One finished file, as recording-service needs to know it. */
export interface ManifestSegment {
  index: number;
  peerId: string;
  userId?: string;
  source: 'camera' | 'screen';
  hasVideo: boolean;
  hasAudio: boolean;
  file: string;             // full path of the .mkv
  startedAtMs: number;
  endedAtMs: number;
}

/** The whole recording, sent as the webhook body and saved as manifest.json. */
export interface Manifest {
  recordingId: string;
  roomId: string;
  reason: string;                      // 'stopped' | 'room-empty' | ...
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
  segments: ManifestSegment[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * recordingDirOf(recordingId)
 *
 * Purpose: one place that builds the folder path /recordings/<recordingId>.
 *          The recording manager (10.3.4) uses it too.
 */
export function recordingDirOf(recordingId: string): string {
  return path.join(env.recordingDir, recordingId);
}

/**
 * finishRecording(manifest)
 *
 * Purpose: tell recording-service "capture is over, these files exist",
 *          with a disk backup in case the message is lost.
 *
 * STEP 1: Write manifest.json (the backup). If this fails, log it and carry on,
 *         because the webhook can still work.
 *
 * STEP 2: POST the same body to recording-service with x-internal-secret.
 *         First try right away, then retry after 1 s, 3 s and 9 s.
 *         Each try has a 5 s timeout. A 2xx answer means done.
 *
 * STEP 3: If every try fails, only log it. The manifest is on disk and
 *         recording-service recovers it on boot (Step 10.11).
 *
 * This function never throws, so a dead recording-service cannot hurt the SFU.
 */
export async function finishRecording(manifest: Manifest): Promise<void> {
  // STEP 1: backup on disk
  try {
    await mkdir(recordingDirOf(manifest.recordingId), { recursive: true });
    await writeFile(
      path.join(recordingDirOf(manifest.recordingId), 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch (err) {
    logger.error({ err, recordingId: manifest.recordingId }, 'Could not write manifest.json');
  }

  // STEP 2: webhook with retries (0 = immediately, then 1 s, 3 s, 9 s)
  const url = `${env.recordingServiceUrl}/internal/recordings/${manifest.recordingId}/capture-ended`;
  for (const wait of [0, 1000, 3000, 9000]) {
    if (wait) await sleep(wait);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': env.internalSecret },
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        logger.info({ recordingId: manifest.recordingId }, 'capture-ended webhook delivered');
        return;
      }
      logger.warn({ recordingId: manifest.recordingId, status: res.status }, 'capture-ended webhook rejected');
    } catch (err) {
      logger.warn({ recordingId: manifest.recordingId, err: String(err) }, 'capture-ended webhook failed');
    }
  }

  // STEP 3: give up, the manifest stays on disk
  logger.error({ recordingId: manifest.recordingId }, 'capture-ended webhook gave up, manifest stays on disk');
}