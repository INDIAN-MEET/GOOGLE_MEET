import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';
import { startRecording, stopRecording } from '../recording/recordingManager.ts';

/**
 * startRecordingHandler   -> POST /api/v1/sfu/recordings/start
 *
 * STEP 1: Read roomId and recordingId. The Joi schema already checked them.
 *
 * STEP 2: startRecording() throws 404 (room missing), 409 (already recording)
 *         or 400 (bad recordingId). AppError keeps its status code.
 *
 * STEP 3: Respond 200 with { recordingId, startedAtMs }.
 */
export async function startRecordingHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, recordingId } = req.body;                          // STEP 1
        const data = await startRecording(roomId, recordingId);            // STEP 2
        res.status(200).json({ success: true, data });                     // STEP 3
    } catch (err) {
        if (!(err instanceof AppError)) {
            logger.error({ err }, 'Failed to start recording');
        }
        next(err instanceof AppError ? err : new AppError('Failed to start recording', 500));
    }
}

/**
 * stopRecordingHandler   -> POST /api/v1/sfu/recordings/stop
 *
 * STEP 1: Read roomId and the optional reason (default "stopped").
 *
 * STEP 2: stopRecording() waits until every FFmpeg file is closed, then
 *         sends the manifest webhook in the background.
 *         No recording for this room -> returns undefined.
 *
 * STEP 3: Respond 200 either way (idempotent).
 *         stopped = true  -> we stopped a real recording.
 *         stopped = false -> nothing was running, nothing to do.
 */
export async function stopRecordingHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, reason } = req.body;                               // STEP 1
        const result = await stopRecording(roomId, reason ?? 'stopped');   // STEP 2

        res.status(200).json({                                             // STEP 3
            success: true,
            data: result ? { stopped: true, ...result } : { stopped: false },
        });
    } catch (err) {
        if (!(err instanceof AppError)) {
            logger.error({ err }, 'Failed to stop recording');
        }
        next(err instanceof AppError ? err : new AppError('Failed to stop recording', 500));
    }
}