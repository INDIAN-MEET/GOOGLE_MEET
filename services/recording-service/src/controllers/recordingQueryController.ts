import type { Recording, RecordingSegment } from '../config/prisma.ts';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.ts';
import { storage } from '../storage/index.ts';
import { AppError } from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

const ACTIVE_STATUSES = ['STARTING', 'RECORDING', 'STOPPING', 'PROCESSING'];

/**
 * Loads a recording and checks that the caller owns it.
 *
 * @param id - Recording id from the URL.
 * @param userId - Caller id from the verified JWT.
 * @returns A promise resolving to the recording row.
 * @throws AppError 404 when it does not exist, 403 when it belongs to someone else.
 */
async function loadOwnedRecording(id: string, userId: string): Promise<Recording> {
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) throw new AppError('Recording not found', 404);
  if (recording.startedBy !== userId) throw new AppError('Forbidden', 403);
  return recording;
}

/**
 * Converts a recording row to the public shape (no file paths or storage keys).
 *
 * @param r - Recording row.
 * @returns The safe recording object.
 */
function toRecordingDto(r: Recording) {
  return {
    id: r.id,
    roomCode: r.roomCode,
    startedBy: r.startedBy,
    status: r.status,
    startedAt: r.startedAt,
    stoppedAt: r.stoppedAt,
    durationMs: r.durationMs,
    hasThumbnail: Boolean(r.thumbKey),
    error: r.error,
  };
}

/**
 * Converts a segment row to the public shape (no rawPath, no storageKey).
 *
 * @param s - Segment row.
 * @returns The safe segment object.
 */
function toSegmentDto(s: RecordingSegment) {
  return {
    id: s.id,
    index: s.index,
    peerId: s.peerId,
    userId: s.userId,
    source: s.source,
    hasVideo: s.hasVideo,
    hasAudio: s.hasAudio,
    startOffsetMs: s.startOffsetMs,
    durationMs: s.durationMs,
    sizeBytes: s.sizeBytes,
    status: s.status,
    error: s.error,
  };
}

/**
 * Builds a download file name that is safe in HTTP headers.
 *
 * @param recording - Recording row.
 * @param segment - Segment row.
 * @returns A name such as "myroom-0-camera.mp4".
 */
function downloadName(recording: Recording, segment: RecordingSegment): string {
  return `${recording.roomCode}-${segment.index}-${segment.source}.mp4`.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Streams one READY segment after all state checks.
 *
 * @param res - Express response.
 * @param recording - Owned recording row.
 * @param segment - Segment row.
 * @param asAttachment - True to force a download instead of inline playback.
 * @returns A promise that resolves when streaming ends.
 * @throws AppError 409 when not ready, 404 when the file is missing from storage.
 */
async function streamSegment(
  res: Response,
  recording: Recording,
  segment: RecordingSegment,
  asAttachment: boolean,
): Promise<void> {
  if (recording.status !== 'READY') throw new AppError(`Recording is ${recording.status}, not ready`, 409);
  if (segment.status !== 'READY' || !segment.storageKey) throw new AppError('Segment is not ready', 409);

  const info = await storage.stat(segment.storageKey);
  if (!info) {
    logger.error({ recordingId: recording.id, segmentId: segment.id }, 'Final file missing from storage');
    throw new AppError('Recording file is missing from storage', 404);
  }
  await storage.send(segment.storageKey, res, asAttachment ? { downloadName: downloadName(recording, segment) } : {});
}

/**
 * GET /v1/recordings : lists the caller's recordings, newest first.
 *
 * @param req - Request (query already validated into res.locals.query).
 * @param res - Response `{ success, data: { items, page, limit, total } }`.
 * @returns A promise that resolves after the response is sent.
 */
export async function listRecordings(req: Request, res: Response): Promise<void> {
  const { roomCode, status, page, limit } = res.locals.query as {
    roomCode?: string;
    status?: Recording['status'];
    page: number;
    limit: number;
  };
  const where = { startedBy: req.userId!, ...(roomCode ? { roomCode } : {}), ...(status ? { status } : {}) };

  const [total, rows] = await prisma.$transaction([
    prisma.recording.count({ where }),
    prisma.recording.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { _count: { select: { segments: true } } },
    }),
  ]);

  const items = rows.map((r) => ({ ...toRecordingDto(r), segmentCount: r._count.segments }));
  res.json({ success: true, data: { items, page, limit, total } });
}

/**
 * GET /v1/recordings/:id : recording details with its segments.
 *
 * @param req - Request with `params.id`.
 * @param res - Response `{ success, data: { recording, segments } }`.
 * @returns A promise that resolves after the response is sent.
 * @throws AppError 404 or 403 (see loadOwnedRecording).
 */
export async function getRecording(req: Request, res: Response): Promise<void> {
  const recording = await loadOwnedRecording(String(req.params.id), req.userId!);
  const segments = await prisma.recordingSegment.findMany({
    where: { recordingId: recording.id },
    orderBy: { index: 'asc' },
  });
  res.json({ success: true, data: { recording: toRecordingDto(recording), segments: segments.map(toSegmentDto) } });
}

/**
 * GET /v1/recordings/:id/download : downloads the first READY segment, or the one named by
 * `?segmentId=`. Always an attachment.
 *
 * @param req - Request with `params.id` and optional `res.locals.query.segmentId`.
 * @param res - Response streaming the MP4.
 * @returns A promise that resolves when streaming ends.
 * @throws AppError 404, 403, or 409 (not ready).
 */
export async function downloadRecording(req: Request, res: Response): Promise<void> {
  const recording = await loadOwnedRecording(String(req.params.id), req.userId!);
  const { segmentId } = res.locals.query as { segmentId?: string };
  const segment = await prisma.recordingSegment.findFirst({
    where: { recordingId: recording.id, ...(segmentId ? { id: segmentId } : { status: 'READY' }) },
    orderBy: { index: 'asc' },
  });
  if (!segment) throw new AppError('Segment not found', 404);
  await streamSegment(res, recording, segment, true);
}

/**
 * GET /v1/recordings/:id/segments/:segmentId/download : streams one segment inline
 * (for a video player, supports Range) or as a download with `?download=1`.
 *
 * @param req - Request with `params.id` and `params.segmentId`.
 * @param res - Response streaming the MP4.
 * @returns A promise that resolves when streaming ends.
 * @throws AppError 404, 403, or 409.
 */
export async function downloadSegment(req: Request, res: Response): Promise<void> {
  const recording = await loadOwnedRecording(String(req.params.id), req.userId!);
  const segment = await prisma.recordingSegment.findFirst({
    where: { id: String(req.params.segmentId), recordingId: recording.id },
  });
  if (!segment) throw new AppError('Segment not found', 404);
  const { download } = res.locals.query as { download: boolean };
  await streamSegment(res, recording, segment, download);
}

/**
 * GET /v1/recordings/:id/thumbnail : streams the JPEG thumbnail.
 *
 * @param req - Request with `params.id`.
 * @param res - Response streaming the image.
 * @returns A promise that resolves when streaming ends.
 * @throws AppError 404 when there is no thumbnail or the file is missing, 403 for other owners.
 */
export async function getThumbnail(req: Request, res: Response): Promise<void> {
  const recording = await loadOwnedRecording(String(req.params.id), req.userId!);
  if (!recording.thumbKey || !(await storage.stat(recording.thumbKey))) throw new AppError('Thumbnail not found', 404);
  await storage.send(recording.thumbKey, res);
}

/**
 * DELETE /v1/recordings/:id : deletes files first, then the database row.
 *
 * If file removal fails the row stays, so the user can retry. File removal is idempotent,
 * so a retry after a half-finished delete is safe.
 *
 * @param req - Request with `params.id`.
 * @param res - Response `{ success, data: { deleted: true } }`.
 * @returns A promise that resolves after the response is sent.
 * @throws AppError 404, 403, or 409 while the recording is still active.
 */
export async function deleteRecording(req: Request, res: Response): Promise<void> {
  const recording = await loadOwnedRecording(String(req.params.id), req.userId!);
  if (ACTIVE_STATUSES.includes(recording.status)) {
    throw new AppError(`Recording is ${recording.status}, wait until it finishes`, 409);
  }
  await storage.removeRecording(recording.id);
  await prisma.recording.delete({ where: { id: recording.id } });
  logger.info({ recordingId: recording.id }, 'Recording deleted');
  res.json({ success: true, data: { deleted: true } });
}
