import { prisma } from '../config/prisma.ts';
import { stopCapture } from '../config/sfuClient.ts';
import { AppError } from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

/**
 * Moves a recording from RECORDING to STOPPING and tells the SFU to stop capturing.
 * Used by the stop endpoint, the auto-stop job, recovery and the disk emergency policy.
 *
 * STEP 1: One conditional update (status must be RECORDING). Zero rows means it was not
 *         active, so a double click or a second caller does nothing.
 * STEP 2: Ask the SFU to stop (it is idempotent).
 * STEP 3: SFU 404 means the room has no Router any more. The capture ended by itself, so the
 *         row stays STOPPING and recovery completes it from the manifest.
 *         Any other error puts the status back to RECORDING and rethrows.
 *
 * @param recordingId - Recording to stop.
 * @param reason - Short label for the logs ("user", "max-duration", "disk-emergency", ...).
 * @returns A promise resolving to "stopping", or "not-active" when it was not RECORDING.
 * @throws AppError when the SFU is unreachable or rejects the request (status restored).
 */
export async function requestStop(recordingId: string, reason: string): Promise<'stopping' | 'not-active'> {
  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) return 'not-active';

  const changed = await prisma.recording.updateMany({
    where: { id: recordingId, status: 'RECORDING' },
    data: { status: 'STOPPING' },
  });
  if (changed.count === 0) return 'not-active';

  try {
    await stopCapture(recording.roomCode, recordingId);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) {
      logger.warn({ recordingId, reason }, 'SFU has no room for this recording; recovery will finish it');
      return 'stopping';
    }
    await prisma.recording.updateMany({ where: { id: recordingId, status: 'STOPPING' }, data: { status: 'RECORDING' } });
    throw err;
  }
  logger.info({ recordingId, reason }, 'Recording stop requested');
  return 'stopping';
}
