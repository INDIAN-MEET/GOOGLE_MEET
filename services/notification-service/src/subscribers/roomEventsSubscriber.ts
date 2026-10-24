import type { Redis } from "ioredis";
import { createRedis } from "../config/redis.ts";
import { cancelRemindersForRoom } from "../services/notificationService.ts";
import { logger } from "../utils/logger.ts";

/** Must match ROOM_EVENTS_CHANNEL in room-service. */
const ROOM_EVENTS_CHANNEL = "room-events";

/**
 * Subscribe to room lifecycle events.
 *
 * Uses a DEDICATED connection: once a Redis connection subscribes it can no
 * longer run normal commands.
 *
 * Handled events:
 *  - "room-ended": cancel all pending reminders for that room.
 *
 * @returns The subscriber connection, so the caller can disconnect on shutdown.
 */
export function startRoomEventsSubscriber(): Redis {
  const sub = createRedis("room-events-subscriber");

  sub.subscribe(ROOM_EVENTS_CHANNEL, (err) => {
    if (err) logger.error({ err }, "Failed to subscribe to room-events");
    else logger.info("Subscribed to room-events");
  });

  sub.on("message", async (_channel, raw) => {
    try {
      const evt = JSON.parse(raw) as { type?: string; roomCode?: string };
      if (evt.type === "room-ended" && evt.roomCode) {
        await cancelRemindersForRoom(evt.roomCode);
      }
    } catch (err) {
      // A malformed message must never crash the subscriber.
      logger.warn({ err, raw }, "Ignoring bad room event");
    }
  });

  return sub;
}
