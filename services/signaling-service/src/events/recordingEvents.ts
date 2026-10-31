import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { REDIS_URL } from '../config/env.js';
import logger from '../utils/logger.js';

const CHANNEL = 'recording-events';
const ROOM_CHANNEL = 'room-events';
const DEDUPE_TTL_MS = 60_000;
const ROOM_CODE_RE = /^[A-Za-z0-9_-]{3,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_BY_TYPE = {
  'recording-started': 'RECORDING',
  'recording-stopped': 'PROCESSING',
  'recording-ready': 'READY',
  'recording-failed': 'FAILED',
} as const;

type RecordingEventType = keyof typeof STATUS_BY_TYPE;

interface ClientRecordingEvent {
  type: RecordingEventType;
  roomCode: string;
  payload: { recordingId: string; roomCode: string; status: string; startedBy?: string };
}

const recentlySeen = new Map<string, number>();

/**
 * Tells whether an event was already handled in the last 60 seconds, and remembers it.
 * Old entries are pruned on every call.
 *
 * @param key - Unique event key ("type:recordingId").
 * @returns True when the event is a duplicate and must be ignored.
 */
function isDuplicate(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of recentlySeen) {
    if (now - at > DEDUPE_TTL_MS) recentlySeen.delete(k);
  }
  if (recentlySeen.has(key)) return true;
  recentlySeen.set(key, now);
  return false;
}

/**
 * Parses and validates one raw Redis message and builds the safe client payload.
 *
 * @param raw - The message string from Redis.
 * @returns The validated event, or null if it is malformed or invalid.
 */
export function parseRecordingEvent(raw: string): ClientRecordingEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { type, roomCode, recordingId, startedBy } = data;
  if (typeof type !== 'string' || !(type in STATUS_BY_TYPE)) return null;
  if (typeof roomCode !== 'string' || !ROOM_CODE_RE.test(roomCode)) return null;
  if (typeof recordingId !== 'string' || !UUID_RE.test(recordingId)) return null;

  const eventType = type as RecordingEventType;
  const payload: ClientRecordingEvent['payload'] = { recordingId, roomCode, status: STATUS_BY_TYPE[eventType] };
  if (eventType === 'recording-started' && typeof startedBy === 'string' && startedBy.length <= 128) {
    payload.startedBy = startedBy;
  }
  return { type: eventType, roomCode, payload };
}

/**
 * Creates the Redis "message" handler that forwards valid events to the Socket.io room.
 *
 * @param io - The Socket.io server.
 * @returns A handler `(channel, raw) => void` that never throws.
 */
function createMessageHandler(io: Server): (channel: string, raw: string) => void {
  return (channel: string, raw: string): void => {
    if (channel === ROOM_CHANNEL) {
      try {
        const data = JSON.parse(raw);
        if (data.type === 'room-ended' && data.roomCode) {
          io.to(data.roomCode).emit('room-ended', { roomCode: data.roomCode });
          logger.info({ roomCode: data.roomCode }, 'Forwarded room-ended event to sockets');
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to parse room event');
      }
      return;
    }

    const event = parseRecordingEvent(raw);
    if (!event) {
      logger.warn('Ignored invalid recording event');
      return;
    }
    if (isDuplicate(`${event.type}:${event.payload.recordingId}`)) return;
    io.to(event.roomCode).emit(event.type, event.payload);
    logger.info({ type: event.type, roomCode: event.roomCode }, 'Recording event sent to room');
  };
}

/**
 * Starts the recording-events subscriber (call once from initSocket).
 *
 * STEP 1: Use a separate Redis connection in subscribe mode.
 * STEP 2: Subscribe on every (re)connect. ioredis re-subscribes by itself, and we log it.
 * STEP 3: Validate, de-duplicate and emit each message to the room.
 *
 * @param io - The Socket.io server.
 * @returns The subscriber connection (close it on shutdown).
 */
export function initRecordingEvents(io: Server): Redis {
  const sub = new Redis(REDIS_URL);

  /**
   * Logs subscriber connection errors; ioredis reconnects automatically.
   *
   * @param err - Connection error.
   */
  const onError = (err: Error): void => {
    logger.error({ err }, 'recording-events subscriber error');
  };

  /**
   * Logs when the connection is (re)established.
   */
  const onReady = (): void => {
    logger.info('recording-events subscriber ready');
  };

  sub.on('error', onError);
  sub.on('ready', onReady);
  sub.subscribe(CHANNEL, ROOM_CHANNEL).catch(onError);
  sub.on('message', createMessageHandler(io));
  return sub;
}
