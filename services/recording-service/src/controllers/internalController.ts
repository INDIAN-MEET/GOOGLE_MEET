import type { Request, Response } from 'express';
import { applyCaptureEnded, type CaptureEndedBody } from '../services/captureEnded.ts';
import { AppError } from '../utils/AppError.ts';

/**
 * POST /internal/recordings/:id/capture-ended : webhook called by the SFU only
 * (protected by internalGuard). All logic lives in applyCaptureEnded so the webhook and
 * boot recovery behave the same. Repeats are answered with 200 (the SFU retries on failure).
 *
 * @param req - Request with `params.id` and the validated segment list in the body.
 * @param res - Response `{ success, data: { status } }`.
 * @returns A promise that resolves after the response is sent.
 * @throws AppError 404 when the recording is unknown.
 */
export async function captureEnded(req: Request, res: Response): Promise<void> {
  const outcome = await applyCaptureEnded(String(req.params.id), req.body as CaptureEndedBody);
  if (outcome === 'not-found') throw new AppError('Recording not found', 404);
  res.json({
    success: true,
    data: outcome === 'duplicate' ? { duplicate: true } : { status: outcome === 'failed' ? 'FAILED' : 'PROCESSING' },
  });
}