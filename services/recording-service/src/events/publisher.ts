import { redis } from '../config/redis.ts';
import { logger } from '../utils/logger.ts';

export interface RecordingEvent {
  type: 'recording-started' | 'recording-stopped' | 'recording-ready' | 'recording-failed';
  roomCode: string;
  recordingId: string;
  startedBy?: string;
}

/**
 * publishRecordingEvent(event)
 *
 * STEP 1: Send the event as JSON on the "recording-events" channel.
 * STEP 2: Never let a Redis problem break recording. Only log it.
 */
export async function publishRecordingEvent(event: RecordingEvent): Promise<void> {
  try {
    await redis.publish('recording-events', JSON.stringify(event));
  } catch (err: unknown) {
    logger.error({ err, event }, 'Failed to publish recording event');
  }
}