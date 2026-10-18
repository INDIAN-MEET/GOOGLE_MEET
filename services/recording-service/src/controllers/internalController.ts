import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { releaseLock } from '../config/redis.js';
import { publishRecordingEvent } from '../events/publisher.js';
import { enqueueFinalize } from '../queue/queues.js';
import { AppError } from '../utils/AppError.js';

interface WebhookSegment {
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

/**
 * captureEnded(req, res)   -> POST /internal/recordings/:id/capture-ended
 * Called by the SFU (protected by internalGuard), never by a browser.
 *
 * STEP 1: Load the recording. Unknown id -> 404.
 * STEP 2: Idempotent: if status is already PROCESSING / READY / FAILED, answer 200 and stop.
 *         The SFU retries webhooks, so the same call can arrive twice.
 * STEP 3: Release the lock and publish "recording-stopped".
 * STEP 4: No segments in the body -> mark FAILED ("No media captured"),
 *         publish "recording-failed", answer 200.
 * STEP 5: Insert one RecordingSegment per item.
 *         startOffsetMs = segment.startedAtMs - recordingStartedAtMs.
 * STEP 6: Set status PROCESSING, stoppedAt, durationMs (steps 5 and 6 in ONE transaction).
 * STEP 7: Enqueue the finalize job with jobId finalize-<recordingId>.
 * STEP 8: Respond 200.
 */
export async function captureEnded(req: Request, res: Response) {
  const id = String(req.params.id);
  const { recordingStartedAtMs, recordingEndedAtMs, segments } = req.body as {
    recordingStartedAtMs: number;
    recordingEndedAtMs: number;
    segments: WebhookSegment[];
  };

  // STEP 1
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) throw new AppError('Recording not found', 404);

  // STEP 2
  if (['PROCESSING', 'READY', 'FAILED'].includes(recording.status)) {
    return res.json({ success: true, data: { duplicate: true } });
  }

  // STEP 3
  await releaseLock(recording.roomCode, id);
  await publishRecordingEvent({ type: 'recording-stopped', roomCode: recording.roomCode, recordingId: id });

  // STEP 4
  if (segments.length === 0) {
    await prisma.recording.update({
      where: { id },
      data: { status: 'FAILED', error: 'No media captured', stoppedAt: new Date(recordingEndedAtMs) },
    });
    await publishRecordingEvent({ type: 'recording-failed', roomCode: recording.roomCode, recordingId: id });
    return res.json({ success: true, data: { status: 'FAILED' } });
  }

  // STEP 5 + STEP 6
  await prisma.$transaction([
    prisma.recordingSegment.createMany({
      data: segments.map((s) => ({
        recordingId: id,
        index: s.index,
        peerId: s.peerId,
        userId: s.userId || null,
        source: s.source,
        hasVideo: s.hasVideo,
        hasAudio: s.hasAudio,
        startOffsetMs: Math.max(0, Math.round(s.startedAtMs - recordingStartedAtMs)),
        durationMs: Math.max(0, Math.round(s.endedAtMs - s.startedAtMs)),
        rawPath: s.file,
      })),
    }),
    prisma.recording.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        stoppedAt: new Date(recordingEndedAtMs),
        durationMs: Math.max(0, Math.round(recordingEndedAtMs - recordingStartedAtMs)),
      },
    }),
  ]);

  // STEP 7
  await enqueueFinalize(id);

  // STEP 8
  res.json({ success: true, data: { status: 'PROCESSING' } });
}