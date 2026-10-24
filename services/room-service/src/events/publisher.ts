import { redisPub } from '../config/redis.js';
import logger from '../utils/logger.js';

/** Channel every service interested in room lifecycle subscribes to. */
export const ROOM_EVENTS_CHANNEL = 'room-events';

/**
 * Publish a room lifecycle event. Failures are swallowed on purpose: a Redis
 * hiccup must never make "end meeting" or "create meeting" fail for the user.
 *
 * @param type Event name, for example "room-ended".
 * @param payload Extra data; `roomCode` is always required.
 */
export async function publishRoomEvent(
  type: 'room-ended',
  payload: { roomCode: string },
): Promise<void> {
  try {
    await redisPub.publish(ROOM_EVENTS_CHANNEL, JSON.stringify({ type, ...payload, at: new Date().toISOString() }));
  } catch (err) {
    logger.error({ err }, 'Failed to publish room event');
  }
}
