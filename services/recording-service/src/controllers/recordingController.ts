import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.ts';
import { acquireLock, releaseLock } from '../config/redis.ts';
import { getActiveRoom } from '../config/roomServiceClient.ts';
import { startCapture, stopCapture } from '../config/sfuClient.ts';
import { publishRecordingEvent } from '../events/publisher.ts';
import { AppError } from '../utils/AppError.ts';

/**
 * startRecording(req, res)   -> POST /v1/recordings/start
 *
 * STEP 1: Read roomCode. The user id comes from the verified JWT (never from the body).
 * STEP 2: Ask Room Service for the room with the caller's token.
 *         Not found or ended -> 404.
 * STEP 3: Host check: room.hostUserId must equal req.userId. Not host -> 403.
 * STEP 4: Create the recording id FIRST, then take the lock with that id
 *         (SET NX). Not acquired -> 409 "Already recording".
 * STEP 5: Insert the Recording row with status STARTING (using the same id).
 * STEP 6: Call the SFU start. On ANY error: release the lock, mark FAILED, rethrow.
 *         SFU 404 means nobody is in the call, so answer 409 "Room is empty".
 * STEP 7: Mark RECORDING and publish "recording-started".
 *         (Auto-stop after MAX_RECORDING_MINUTES is added in Step 10.11.)
 * STEP 8: Respond 201 { recordingId, status: 'RECORDING' }.
 */
export async function startRecording(req: Request, res: Response) {
  // STEP 1
  const { roomCode } = req.body as { roomCode: string };
  const userId = req.userId!;

  // STEP 2
  const room = await getActiveRoom(roomCode, req.token!);
  if (!room) throw new AppError('Room not found', 404);

  // STEP 3
  if (room.hostUserId !== userId) throw new AppError('Only the room host can record', 403);

  // STEP 4
  const recordingId = randomUUID();
  const locked = await acquireLock(roomCode, recordingId);
  if (!locked) throw new AppError('Already recording', 409);

  try {
    // STEP 5
    await prisma.recording.create({
      data: { id: recordingId, roomCode, startedBy: userId, status: 'STARTING' },
    });

    // STEP 6
    await startCapture(roomCode, recordingId);
  } catch (err) {
    await releaseLock(roomCode, recordingId);
    await prisma.recording.updateMany({
      where: { id: recordingId },
      data: { status: 'FAILED', error: err instanceof Error ? err.message : 'Start failed' },
    });
    if (err instanceof AppError && err.statusCode === 404) {
      throw new AppError('Room is empty', 409);
    }
    throw err;
  }

  // STEP 7
  await prisma.recording.update({ where: { id: recordingId }, data: { status: 'RECORDING' } });
  await publishRecordingEvent({
    type: 'recording-started',
    roomCode,
    recordingId,
    startedBy: userId,
  });

  // STEP 8
  res.status(201).json({ success: true, data: { recordingId, status: 'RECORDING' } });
}

/**
 * stopRecording(req, res)   -> POST /v1/recordings/:id/stop
 *
 * STEP 1: Load the recording. Not found -> 404. startedBy !== caller -> 403.
 * STEP 2: Move RECORDING -> STOPPING in ONE database update (updateMany with a
 *         status filter). If 0 rows changed, it was not RECORDING -> 409.
 *         This also blocks a double click from stopping twice.
 * STEP 3: Call the SFU stop. It answers fast. The real result arrives by webhook.
 *         If the SFU call fails, put the status back to RECORDING and rethrow.
 * STEP 4: Respond 202 { status: 'STOPPING' }.
 */
export async function stopRecording(req: Request, res: Response) {
  const id = String(req.params.id);

  // STEP 1
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording) throw new AppError('Recording not found', 404);
  if (recording.startedBy !== req.userId) throw new AppError('Forbidden', 403);

  // STEP 2
  const changed = await prisma.recording.updateMany({
    where: { id, status: 'RECORDING' },
    data: { status: 'STOPPING' },
  });
  if (changed.count === 0) throw new AppError('Recording is not active', 409);

  // STEP 3
  try {
    await stopCapture(recording.roomCode, id);
  } catch (err) {
    await prisma.recording.updateMany({
      where: { id, status: 'STOPPING' },
      data: { status: 'RECORDING' },
    });
    throw err;
  }

  // STEP 4
  res.status(202).json({ success: true, data: { status: 'STOPPING' } });
}