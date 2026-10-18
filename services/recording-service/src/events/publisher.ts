import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

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
        redis.publish('recording-events', JSON.stringify(event))
    } catch (err:any) {
        logger.error({ err, event }, 'Failed to publish recording event')
    }
    
}