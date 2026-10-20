import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.ts';
import { prisma } from '../config/prisma.ts';
import { getFinalizeJobState, isJobInFlight } from '../queue/queues.ts';
import { resolveInsideRoot, UUID_RE } from '../storage/paths.ts';
import { storage } from '../storage/index.ts';
import { logger } from '../utils/logger.ts';

const TEMP_MAX_AGE_MS = 60 * 60_000;

/**
 * Deletes the raw MKV and SDP files of READY segments of old READY recordings.
 *
 * Safety rules:
 * - only READY recordings older than RAW_RETENTION_HOURS;
 * - skipped while a finalize job is in flight;
 * - a segment's raw file is deleted only after its final MP4 exists and is not empty;
 * - raw files of FAILED segments are always kept (they may be the only copy);
 * - failures are logged and retried next run (rawCleanedAt is set only after success).
 *
 * @returns A promise that resolves when up to 25 recordings were processed.
 */
async function cleanRawFiles(): Promise<void> {
  const cutoff = new Date(Date.now() - env.rawRetentionHours * 3_600_000);
  const recordings = await prisma.recording.findMany({
    where: { status: 'READY', rawCleanedAt: null, stoppedAt: { lt: cutoff } },
    include: { segments: true },
    orderBy: { stoppedAt: 'asc' },
    take: 25,
  });

  for (const r of recordings) {
    try {
      if (isJobInFlight(await getFinalizeJobState(r.id))) continue;

      const readySegments = r.segments.filter((s) => s.status === 'READY');
      let verified = true;
      for (const s of readySegments) {
        const info = s.storageKey ? await storage.stat(s.storageKey) : null;
        if (!info || info.sizeBytes <= 0) verified = false;
      }
      if (!verified) {
        logger.warn({ recordingId: r.id }, 'Final file missing, raw files kept');
        continue;
      }

      for (const s of readySegments) {
        const rawAbs = resolveInsideRoot(env.recordingDir, s.rawPath);
        await rm(rawAbs, { force: true });
        await rm(rawAbs.replace(/\.mkv$/, '.sdp'), { force: true });
      }
      await rmdir(path.join(path.resolve(env.recordingDir), r.id, 'raw')).catch(() => undefined);
      await prisma.recording.update({ where: { id: r.id }, data: { rawCleanedAt: new Date() } });
      logger.info({ recordingId: r.id, segments: readySegments.length }, 'Raw files cleaned');
    } catch (err) {
      logger.error({ err, recordingId: r.id }, 'Raw cleanup failed, will retry next run');
    }
  }
}

/**
 * Deletes abandoned temporary files ("*.part.*") older than one hour from `final/` folders.
 * Anything still being written has a fresh modification time, so it is left alone.
 *
 * @returns A promise that resolves when all recording folders were scanned.
 */
async function cleanTempFiles(): Promise<void> {
  const root = path.resolve(env.recordingDir);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_RE.test(entry.name)) continue;
    try {
      if (isJobInFlight(await getFinalizeJobState(entry.name))) continue;
      const finalDir = path.join(root, entry.name, 'final');
      for (const file of await readdir(finalDir).catch(() => [])) {
        if (!file.includes('.part.')) continue;
        const full = path.join(finalDir, file);
        const info = await stat(full).catch(() => null);
        if (info && Date.now() - info.mtimeMs > TEMP_MAX_AGE_MS) {
          await rm(full, { force: true });
          logger.info({ recordingId: entry.name, file }, 'Removed abandoned temp file');
        }
      }
    } catch (err) {
      logger.error({ err, recordingId: entry.name }, 'Temp cleanup failed');
    }
  }
}

/**
 * Runs all cleanup tasks once. Safe to run repeatedly (idempotent).
 *
 * @returns A promise that resolves when both tasks finished.
 */
export async function runCleanup(): Promise<void> {
  await cleanRawFiles();
  await cleanTempFiles();
}
