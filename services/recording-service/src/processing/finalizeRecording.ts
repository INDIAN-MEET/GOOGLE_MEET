import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { env } from '../config/env.ts';
import { prisma, type RecordingSegment } from '../config/prisma.ts';
import { releaseLock } from '../config/redis.ts';
import { publishRecordingEvent } from '../events/publisher.ts';
import { logger } from '../utils/logger.ts';
import { resolveInsideRoot, sanitizeFileStem, toStorageKey } from '../storage/paths.ts';
import { MediaToolError, probeMedia, runFfmpeg, type ProbeResult } from './ffmpeg.ts';

/** Raw files smaller than this cannot contain real media (your 521 byte test file is below it). */
const MIN_RAW_BYTES = 2048;

/**
 * Error for problems that retrying cannot fix (missing, tiny, or unreadable source media).
 */
export class SourceMediaError extends Error {
  /**
   * Creates the error.
   *
   * @param message - Short, path-free reason that is safe to store and show.
   */
  constructor(message: string) {
    super(message);
    this.name = 'SourceMediaError';
  }
}

export interface FinalizeResult {
  readySegments: number;
  failedSegments: number;
}

interface ConvertedSegment {
  storageKey: string;
  sizeBytes: number;
  durationMs: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Builds the ffmpeg arguments that turn a raw MKV into a browser-friendly MP4.
 *
 * - video: H.264, even width/height (libx264 requires it), yuv420p
 * - audio: AAC 128k (the raw track is Opus, which MP4 players do not like)
 * - +faststart: moov atom first, so playback starts before the full download
 * - Only the streams that really exist are mapped, so audio-only files work.
 *
 * @param inputPath - Absolute path of the raw MKV.
 * @param outputPath - Absolute path of the temporary MP4.
 * @param probe - ffprobe result for the input.
 * @returns The ffmpeg argument list.
 */
export function buildMp4Args(inputPath: string, outputPath: string, probe: ProbeResult): string[] {
  const args = ['-y', '-fflags', '+genpts', '-i', inputPath];
  if (probe.hasVideo) {
    args.push(
      '-map', '0:v:0',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    );
  }
  if (probe.hasAudio) {
    args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k');
  }
  args.push('-movflags', '+faststart', '-f', 'mp4', outputPath);
  return args;
}

/**
 * Converts one raw segment to MP4 and validates the result.
 *
 * STEP 1: Check the raw file is inside the root, exists, and is large enough.
 * STEP 2: ffprobe the input. A probe failure means unreadable media (not retryable).
 * STEP 3: Convert into "<name>.part.mp4", then rename to "<name>.mp4" (atomic output).
 * STEP 4: ffprobe the output for the real duration and make sure it is not empty.
 * STEP 5: On any failure remove the temporary file.
 *
 * @param recordingId - Recording that owns the segment.
 * @param segment - Segment row to convert.
 * @param finalDir - Absolute directory for final MP4 files.
 * @returns A promise resolving to the metadata to save on the segment.
 * @throws SourceMediaError for permanent source problems, MediaToolError for tool problems.
 */
async function convertSegment(
  recordingId: string,
  segment: RecordingSegment,
  finalDir: string,
): Promise<ConvertedSegment> {
  // STEP 1
  const rawAbs = resolveInsideRoot(env.recordingDir, segment.rawPath);
  const rawStat = await stat(rawAbs).catch(() => null);
  if (!rawStat) throw new SourceMediaError('Raw file is missing');
  if (rawStat.size < MIN_RAW_BYTES) throw new SourceMediaError('Raw file is empty or too small');

  // STEP 2
  let inputProbe: ProbeResult;
  try {
    inputProbe = await probeMedia(rawAbs);
  } catch (err) {
    if (err instanceof MediaToolError && err.kind === 'exit') {
      logger.warn({ recordingId, segmentId: segment.id, stderr: err.stderr }, 'ffprobe rejected raw file');
      throw new SourceMediaError('Raw file is not readable media');
    }
    throw err;
  }
  if (!inputProbe.hasVideo && !inputProbe.hasAudio) throw new SourceMediaError('Raw file has no media streams');

  // STEP 3
  const stem = sanitizeFileStem(path.basename(rawAbs, path.extname(rawAbs)));
  const finalAbs = path.join(finalDir, `${stem}.mp4`);
  const tempAbs = path.join(finalDir, `${stem}.part.mp4`);

  try {
    await runFfmpeg(buildMp4Args(rawAbs, tempAbs, inputProbe));
    await rename(tempAbs, finalAbs);

    // STEP 4
    const outStat = await stat(finalAbs);
    if (outStat.size <= 0) throw new SourceMediaError('Conversion produced an empty file');
    const outProbe = await probeMedia(finalAbs);
    if (!outProbe.hasVideo && !outProbe.hasAudio) throw new SourceMediaError('Converted file has no media streams');

    const durationSec = outProbe.durationSec ?? inputProbe.durationSec;
    return {
      storageKey: toStorageKey(env.recordingDir, finalAbs),
      sizeBytes: outStat.size,
      durationMs: durationSec === null ? null : Math.round(durationSec * 1000),
      hasVideo: outProbe.hasVideo,
      hasAudio: outProbe.hasAudio,
    };
  } catch (err) {
    // STEP 5
    await rm(tempAbs, { force: true });
    if (err instanceof MediaToolError) {
      logger.error({ recordingId, segmentId: segment.id, stderr: err.stderr, kind: err.kind }, 'ffmpeg failed');
    }
    throw err;
  }
}

/**
 * Creates a JPEG thumbnail from a converted video file (1 second in, or the first frame
 * if the video is shorter). Written to a temporary file and renamed.
 *
 * @param videoAbs - Absolute path of the final MP4.
 * @param thumbAbs - Absolute path of the final JPEG.
 * @returns A promise resolving to true when the thumbnail exists, false otherwise (never throws).
 */
async function makeThumbnail(videoAbs: string, thumbAbs: string): Promise<boolean> {
  const tempAbs = thumbAbs.replace(/\.jpg$/, '.part.jpg');
  for (const seekSeconds of ['1', '0']) {
    try {
      await runFfmpeg(
        ['-y', '-ss', seekSeconds, '-i', videoAbs, '-frames:v', '1', '-vf', 'scale=640:-2', '-update', '1', tempAbs],
        120_000,
      );
      const info = await stat(tempAbs).catch(() => null);
      if (info && info.size > 0) {
        await rename(tempAbs, thumbAbs);
        return true;
      }
    } catch (err) {
      logger.warn({ err, seekSeconds }, 'Thumbnail attempt failed');
    }
  }
  await rm(tempAbs, { force: true });
  return false;
}

/**
 * Finalizes one recording: converts its segments, saves metadata, and announces the result.
 *
 * The function is idempotent: READY segments are skipped, a READY recording returns at once,
 * and the final status update only succeeds while the recording is still PROCESSING, so the
 * Redis event is published once.
 *
 * @param recordingId - Id of the recording to process.
 * @param onProgress - Optional callback receiving progress 0 to 100.
 * @returns A promise resolving to the number of ready and failed segments.
 * @throws UnrecoverableError when the recording is unknown or no segment can ever succeed;
 *         a plain Error when a retry might help.
 */
export async function finalizeRecording(
  recordingId: string,
  onProgress?: (percent: number) => Promise<void>,
): Promise<FinalizeResult> {
  const log = logger.child({ recordingId });

  // STEP 1
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: { segments: { orderBy: { index: 'asc' } } },
  });
  if (!recording) throw new UnrecoverableError('Recording not found');
  if (recording.status === 'READY') {
    log.info('Recording already READY, nothing to do');
    return { readySegments: recording.segments.length, failedSegments: 0 };
  }
  if (recording.status !== 'PROCESSING') {
    throw new UnrecoverableError(`Recording is ${recording.status}, expected PROCESSING`);
  }
  if (recording.segments.length === 0) throw new UnrecoverableError('Recording has no segments');

  const finalDir = path.join(path.resolve(env.recordingDir), recordingId, 'final');
  await mkdir(finalDir, { recursive: true });
  log.info({ segments: recording.segments.length }, 'Finalize job started');

  // STEP 2
  let ready = recording.segments.filter((s) => s.status === 'READY').length;
  let failed = 0;
  let anyRetryable = false;
  let firstReason = '';

  for (const [position, segment] of recording.segments.entries()) {
    if (segment.status !== 'READY') {
      try {
        const out = await convertSegment(recordingId, segment, finalDir);
        await prisma.recordingSegment.update({
          where: { id: segment.id },
          data: { ...out, status: 'READY', error: null },
        });
        ready += 1;
        log.info({ segmentId: segment.id, sizeBytes: out.sizeBytes, durationMs: out.durationMs }, 'Segment converted');
      } catch (err) {
        failed += 1;
        if (!(err instanceof SourceMediaError)) anyRetryable = true;
        const reason = err instanceof Error ? err.message : 'Unknown error';
        if (!firstReason) firstReason = reason;
        await prisma.recordingSegment.update({
          where: { id: segment.id },
          data: { status: 'FAILED', error: reason.slice(0, 500) },
        });
        log.error({ err, segmentId: segment.id }, 'Segment failed');
      }
    }
    if (onProgress) await onProgress(Math.round(((position + 1) / recording.segments.length) * 90));
  }

  // STEP 3
  if (ready === 0) {
    const message = `No segment could be finalized: ${firstReason}`;
    throw anyRetryable ? new Error(message) : new UnrecoverableError(message);
  }

  // STEP 4
  const readySegments = await prisma.recordingSegment.findMany({
    where: { recordingId, status: 'READY' },
    orderBy: { index: 'asc' },
  });
  let thumbKey: string | null = null;
  const videoSegment = readySegments.find((s) => s.hasVideo && s.storageKey);
  if (videoSegment?.storageKey) {
    const thumbAbs = path.join(finalDir, 'thumb.jpg');
    const videoAbs = resolveInsideRoot(env.recordingDir, videoSegment.storageKey);
    if (await makeThumbnail(videoAbs, thumbAbs)) thumbKey = toStorageKey(env.recordingDir, thumbAbs);
  }

  // STEP 5
  const updated = await prisma.recording.updateMany({
    where: { id: recordingId, status: 'PROCESSING' },
    data: { status: 'READY', thumbKey, error: null },
  });
  if (updated.count === 1) {
    await publishRecordingEvent({ type: 'recording-ready', roomCode: recording.roomCode, recordingId });
    log.info({ ready, failed }, 'Recording finalized');
  } else {
    log.warn('Recording was no longer PROCESSING, event not published');
  }
  if (onProgress) await onProgress(100);
  return { readySegments: ready, failedSegments: failed };
}

/**
 * Marks a recording FAILED, releases the room lock, and publishes "recording-failed" once.
 *
 * Only recordings that are not already READY or FAILED are changed, so calling this twice
 * (for example from a retry and from recovery) produces one event.
 *
 * @param recordingId - Id of the recording.
 * @param reason - Short reason saved in the `error` column (cut to 500 characters).
 * @returns A promise resolving to true when the recording was changed, false otherwise.
 * @throws Error when the database or Redis is unavailable.
 */
export async function markRecordingFailed(recordingId: string, reason: string): Promise<boolean> {
  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) return false;

  const changed = await prisma.recording.updateMany({
    where: { id: recordingId, status: { notIn: ['READY', 'FAILED'] } },
    data: { status: 'FAILED', error: reason.slice(0, 500) },
  });
  if (changed.count === 0) return false;

  await releaseLock(recording.roomCode, recordingId);
  await publishRecordingEvent({ type: 'recording-failed', roomCode: recording.roomCode, recordingId });
  logger.error({ recordingId, reason }, 'Recording marked FAILED');
  return true;
}
