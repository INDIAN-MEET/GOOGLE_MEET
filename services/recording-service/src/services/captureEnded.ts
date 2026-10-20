import { prisma } from '../config/prisma.ts';
import { releaseLock } from '../config/redis.ts';
import { publishRecordingEvent } from '../events/publisher.ts';
import { cancelAutoStop } from '../queue/autoStop.ts';
import { enqueueFinalize } from '../queue/queues.ts';
import { logger } from '../utils/logger.ts';

export interface CaptureEndedSegment {
  index: number;
  peerId: string;
  userId?: string | null;
  source: 'camera' | 'screen';
  hasVideo: boolean;
  hasAudio: boolean;
  file: string;
  startedAtMs: number;
  endedAtMs: number;
}

export interface CaptureEndedBody {
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
  segments: CaptureEndedSegment[];
}

export type CaptureEndedOutcome = 'not-found' | 'duplicate' | 'failed' | 'processing';

/**
 * Applies "capture ended" to a recording. Called by the SFU webhook AND by recovery
 * (from manifest.json), so both paths behave identically.
 *
 * STEP 1: In ONE transaction, claim the recording (STARTING, RECORDING or STOPPING moves to
 *         PROCESSING, or FAILED when there are no segments) and insert the segments.
 *         A repeated webhook claims nothing and is reported as "duplicate".
 * STEP 2: Release the lock and cancel the auto-stop job.
 * STEP 3: Publish "recording-stopped" (and "recording-failed" when no media).
 * STEP 4: Queue the finalize job (the job id makes a repeat harmless).
 *
 * @param recordingId - Recording id.
 * @param body - Segment list and timestamps from the SFU or the manifest.
 * @returns A promise resolving to what happened.
 * @throws Error when the database or Redis is unavailable (the SFU retries the webhook).
 */
export async function applyCaptureEnded(recordingId: string, body: CaptureEndedBody): Promise<CaptureEndedOutcome> {
  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) return 'not-found';

  const hasSegments = body.segments.length > 0;
  const stoppedAt = new Date(body.recordingEndedAtMs);
  const durationMs = Math.max(0, Math.round(body.recordingEndedAtMs - body.recordingStartedAtMs));

  // STEP 1
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.recording.updateMany({
      where: { id: recordingId, status: { in: ['STARTING', 'RECORDING', 'STOPPING'] } },
      data: hasSegments
        ? { status: 'PROCESSING', stoppedAt, durationMs }
        : { status: 'FAILED', stoppedAt, durationMs, error: 'No media captured' },
    });
    if (result.count === 0) return false;
    if (hasSegments) {
      await tx.recordingSegment.createMany({
        data: body.segments.map((s) => ({
          recordingId,
          index: s.index,
          peerId: s.peerId,
          userId: s.userId || null,
          source: s.source,
          hasVideo: s.hasVideo,
          hasAudio: s.hasAudio,
          startOffsetMs: Math.max(0, Math.round(s.startedAtMs - body.recordingStartedAtMs)),
          durationMs: Math.max(0, Math.round(s.endedAtMs - s.startedAtMs)),
          rawPath: s.file,
        })),
      });
    }
    return true;
  });
  if (!claimed) return 'duplicate';

  // STEP 2
  await releaseLock(recording.roomCode, recordingId);
  await cancelAutoStop(recordingId);

  // STEP 3
  await publishRecordingEvent({ type: 'recording-stopped', roomCode: recording.roomCode, recordingId });
  if (!hasSegments) {
    await publishRecordingEvent({ type: 'recording-failed', roomCode: recording.roomCode, recordingId });
    logger.warn({ recordingId }, 'Capture ended with no segments');
    return 'failed';
  }

  // STEP 4
  await enqueueFinalize(recordingId);
  return 'processing';
}
