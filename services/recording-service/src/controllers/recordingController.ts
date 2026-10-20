import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.ts';
import { acquireLock, releaseLock } from '../config/redis.ts';
import { getActiveRoom } from '../config/roomServiceClient.ts';
import { startCapture } from '../config/sfuClient.ts';
import { publishRecordingEvent } from '../events/publisher.ts';
import { assertDiskSpace } from '../maintenance/diskGuard.ts';
import { cancelAutoStop, scheduleAutoStop } from '../queue/autoStop.ts';
import { requestStop } from '../services/recordingLifecycle.ts';
import { AppError } from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

/**
 * POST /v1/recordings/start : starts a recording (host only).
 *
 * STEP 1: Read roomCode; the user id comes from the verified JWT.
 * STEP 2: Ask Room Service for the room. Not found or ended gives 404.
 * STEP 3: Host check (room.hostUserId === caller), otherwise 403.
 * STEP 4: Disk guard. Critically low space gives 503 before any state is created.
 * STEP 5: Take the Redis lock (one recording per room), otherwise 409.
 * STEP 6: Insert the row (STARTING), call the SFU. On error: unlock, mark FAILED, rethrow
 *         (SFU 404 means nobody is in the call, so 409 "Room is empty").
 * STEP 7: Mark RECORDING, publish "recording-started", schedule the auto-stop job.
 * STEP 8: Respond 201.
 *
 * @param req - Request with body `{ roomCode }`.
 * @param res - Response `{ success, data: { recordingId, status } }`.
 * @returns A promise that resolves after the response is sent.
 * @throws AppError 403, 404, 409, 503 or the SFU error.
 */
export async function startRecording(req: Request, res: Response): Promise<void> {
  // STEP 1
  const { roomCode } = req.body as { roomCode: string };
  const userId = req.userId!;

  // STEP 2
  const room = await getActiveRoom(roomCode, req.token!);
  if (!room) throw new AppError('Room not found', 404);

  // STEP 3
  if (room.hostUserId !== userId) throw new AppError('Only the room host can record', 403);

  // STEP 4
  await assertDiskSpace();

  // STEP 5
  const recordingId = randomUUID();
  if (!(await acquireLock(roomCode, recordingId))) throw new AppError('Already recording', 409);

  try {
    // STEP 6
    await prisma.recording.create({ data: { id: recordingId, roomCode, startedBy: userId, status: 'STARTING' } });
    await startCapture(roomCode, recordingId);
  } catch (err) {
    await releaseLock(roomCode, recordingId);
    await prisma.recording.updateMany({
      where: { id: recordingId },
      data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 500) : 'Start failed' },
    });
    if (err instanceof AppError && err.statusCode === 404) throw new AppError('Room is empty', 409);
    throw err;
  }

  // STEP 7
  await prisma.recording.update({ where: { id: recordingId }, data: { status: 'RECORDING' } });
  await publishRecordingEvent({ type: 'recording-started', roomCode, recordingId, startedBy: userId });
  try {
    await scheduleAutoStop(recordingId);
  } catch (err) {
    logger.error({ err, recordingId }, 'Could not schedule auto-stop (recovery enforces the limit)');
  }

  // STEP 8
  res.status(201).json({ success: true, data: { recordingId, status: 'RECORDING' } });
}

/**
 * POST /v1/recordings/:id/stop : stops a recording (owner only).
 *
 * STEP 1: Load the recording. 404 if missing, 403 if the caller is not the owner.
 * STEP 2: requestStop() does the atomic RECORDING to STOPPING change and calls the SFU.
 *         "not-active" means it was not RECORDING, so 409.
 * STEP 3: Cancel the auto-stop job and respond 202. The result arrives by webhook.
 *
 * @param req - Request with `params.id`.
 * @param res - Response `{ success, data: { status: 'STOPPING' } }`.
 * @returns A promise that resolves after the response is sent.
 * @throws AppError 403, 404, 409 or the SFU error (status restored to RECORDING).
 */
export async function stopRecording(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);

  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) throw new AppError('Recording not found', 404);
  if (recording.startedBy !== req.userId) throw new AppError('Forbidden', 403);

  if ((await requestStop(id, 'user')) === 'not-active') throw new AppError('Recording is not active', 409);

  await cancelAutoStop(id);
  res.status(202).json({ success: true, data: { status: 'STOPPING' } });
}