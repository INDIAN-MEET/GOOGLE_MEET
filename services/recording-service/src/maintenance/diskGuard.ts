import { statfs } from 'node:fs/promises';
import { env } from '../config/env.ts';
import { prisma } from '../config/prisma.ts';
import { requestStop } from '../services/recordingLifecycle.ts';
import { AppError } from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

export type DiskLevel = 'ok' | 'warning' | 'critical';

export interface DiskStatus {
  freeMb: number;
  totalMb: number;
  freePercent: number;
  level: DiskLevel;
}

/**
 * Reads free space of the filesystem that holds the recordings directory.
 * Inside Docker this is the filesystem of the mounted volume, so it reports the real limit.
 *
 * @returns A promise resolving to free and total space and the level (ok, warning, critical).
 * @throws Error when the directory cannot be read.
 */
export async function getDiskStatus(): Promise<DiskStatus> {
  const info = await statfs(env.recordingDir);
  const freeMb = Math.floor((Number(info.bavail) * Number(info.bsize)) / 1_048_576);
  const totalMb = Math.floor((Number(info.blocks) * Number(info.bsize)) / 1_048_576);
  const level: DiskLevel =
    freeMb < env.diskCriticalFreeMb ? 'critical' : freeMb < env.diskWarnFreeMb ? 'warning' : 'ok';
  return { freeMb, totalMb, freePercent: totalMb > 0 ? Math.round((freeMb / totalMb) * 100) : 0, level };
}

/**
 * Refuses to start a recording when space is critical or the volume cannot be read
 * (fail closed). Active recordings are not touched.
 *
 * @returns A promise that resolves when it is safe to start.
 * @throws AppError 503 when storage is low or unavailable.
 */
export async function assertDiskSpace(): Promise<void> {
  let status: DiskStatus;
  try {
    status = await getDiskStatus();
  } catch (err) {
    logger.error({ err }, 'Storage status unavailable');
    throw new AppError('Recording storage is unavailable', 503);
  }
  if (status.level === 'critical') throw new AppError('Not enough storage space to start a recording', 503);
}

/**
 * Periodic disk policy: logs warnings and critical levels, and (only if
 * DISK_EMERGENCY_FREE_MB > 0) stops all active recordings below that threshold. A stopped
 * recording is still finalized normally, so no data is thrown away.
 *
 * @returns A promise that resolves when the check is done.
 */
export async function enforceDiskPolicy(): Promise<void> {
  const status = await getDiskStatus();
  if (status.level === 'warning') logger.warn({ freeMb: status.freeMb }, 'Recording disk space is low');
  if (status.level === 'critical') logger.error({ freeMb: status.freeMb }, 'Recording disk space is CRITICAL');

  if (env.diskEmergencyFreeMb > 0 && status.freeMb < env.diskEmergencyFreeMb) {
    const active = await prisma.recording.findMany({ where: { status: 'RECORDING' }, select: { id: true } });
    for (const { id } of active) {
      try {
        await requestStop(id, 'disk-emergency');
      } catch (err) {
        logger.error({ err, recordingId: id }, 'Emergency stop failed');
      }
    }
  }
}
