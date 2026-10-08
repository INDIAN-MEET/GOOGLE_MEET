import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';
import { getRouter } from '../mediasoup/roomManager.ts';
import { getPeer, getPeerCount, listPeerIds } from '../mediasoup/peerManager.ts';
import { startSegment } from './segmentRecorder.ts';
import type { ActiveSegment, SegmentSource } from './segmentRecorder.ts';
import { finishRecording, recordingDirOf } from './manifest.ts';
import type { Manifest, ManifestSegment } from './manifest.ts';

/** Wait this long after a producer change before touching segments (camera + mic arrive together). */
const SYNC_DELAY_MS = 700;

/** After this many FFmpeg crashes for the same peer and source, we stop retrying. */
const MAX_CRASHES = 3;

/** Everything we know about one running recording. */
interface ActiveRecording {
  recordingId: string;
  roomId: string;
  startedAtMs: number;
  nextIndex: number;                              // order number for the next segment
  active: Map<string, ActiveSegment>;             // key = "<peerId>:<source>"
  finished: ManifestSegment[];                    // segments already closed
  timers: Map<string, ReturnType<typeof setTimeout>>; // debounce timer per peer
  crashes: Map<string, number>;                   // crash counter per key
  queue: Promise<void>;                           // all work for this recording runs one by one
  stopping: boolean;
}

// roomId -> its running recording (only one per room)
const recordings = new Map<string, ActiveRecording>();

/**
 * enqueue(rec, fn)
 *
 * Purpose: run async work for ONE recording strictly one after another.
 *
 * STEP 1: Chain fn after everything that is already queued.
 *
 * STEP 2: Keep the chain alive even if fn fails (log the error, never break the chain).
 *
 * STEP 3: Return the result promise so a caller can await it if it wants to.
 *         Callers that do not await must add .catch() themselves.
 */
function enqueue<T>(rec: ActiveRecording, fn: () => Promise<T>): Promise<T> {
  const run = rec.queue.then(fn);                       // STEP 1
  rec.queue = run.then(                                 // STEP 2
    () => undefined,
    (err) => { logger.error({ err, recordingId: rec.recordingId }, 'Recording task failed'); },
  );
  return run;                                           // STEP 3
}

/**
 * toManifestSegment(seg, endedAtMs)
 *
 * Purpose: convert a finished ActiveSegment into the shape recording-service reads.
 */
function toManifestSegment(seg: ActiveSegment, endedAtMs: number): ManifestSegment {
  return {
    index: seg.index,
    peerId: seg.peerId,
    userId: seg.userId,
    source: seg.source,
    hasVideo: seg.hasVideo,
    hasAudio: seg.hasAudio,
    file: seg.file,
    startedAtMs: seg.startedAtMs,
    endedAtMs,
  };
}

/**
 * endSegment(rec, key)
 *
 * Purpose: stop one running segment and move it to the "finished" list.
 *
 * STEP 1: Take the segment out of "active" FIRST, so nobody else touches it.
 *
 * STEP 2: stop() lets FFmpeg finish the file, then frees ports and transports.
 *
 * STEP 3: Remember it for the manifest.
 */
async function endSegment(rec: ActiveRecording, key: string): Promise<void> {
  const seg = rec.active.get(key);
  if (!seg) return;
  rec.active.delete(key);                                       // STEP 1
  const { endedAtMs } = await seg.stop();                       // STEP 2
  rec.finished.push(toManifestSegment(seg, endedAtMs));         // STEP 3
}

/**
 * reconcile(rec, peerId, source, producers)
 *
 * Purpose: make the running segment match the peer's live producers.
 *
 * STEP 1: Build the key and a comparable "wanted" string from the producer ids.
 *
 * STEP 2: Same producers as the running segment -> nothing to do.
 *
 * STEP 3: Different -> stop the old segment (it becomes a finished file).
 *
 * STEP 4: No producers left -> done (the peer turned everything off or left).
 *
 * STEP 5: Too many crashes for this key -> give up, log it.
 *
 * STEP 6: Start a new segment. If it fails, log it and carry on.
 *         One broken peer must not stop the rest of the recording.
 */
async function reconcile(
  rec: ActiveRecording,
  peerId: string,
  source: SegmentSource,
  producers: import('mediasoup').types.Producer[],
): Promise<void> {
  // STEP 1
  const key = `${peerId}:${source}`;
  const wanted = producers.map((p) => p.id).sort().join(',');
  const current = rec.active.get(key);

  // STEP 2
  if (current && [...current.producerIds].sort().join(',') === wanted) return;

  // STEP 3
  if (current) await endSegment(rec, key);

  // STEP 4
  if (producers.length === 0) return;

  // STEP 5
  if ((rec.crashes.get(key) ?? 0) >= MAX_CRASHES) {
    logger.warn({ recordingId: rec.recordingId, key }, 'Too many ffmpeg crashes, not restarting');
    return;
  }

  // STEP 6
  try {
    const router = await getRouter(rec.roomId);
    const userId = producers[0]?.appData.userId;
    const seg = await startSegment({
      router,
      dir: path.join(recordingDirOf(rec.recordingId), 'raw'),
      index: rec.nextIndex++,
      peerId,
      userId: typeof userId === 'string' ? userId : undefined,
      source,
      producers,
      onUnexpectedExit: () => {
        // FFmpeg died by itself. Close this segment and let sync start a fresh one.
        if (rec.stopping || rec.active.get(key) === undefined) return;
        rec.crashes.set(key, (rec.crashes.get(key) ?? 0) + 1);
        enqueue(rec, async () => {
          await endSegment(rec, key);
          await syncPeer(rec, peerId);
        }).catch(() => undefined);
      },
    });
    rec.active.set(key, seg);
    logger.info({ recordingId: rec.recordingId, peerId, source, file: seg.file }, 'Segment started');
  } catch (err) {
    logger.error({ err, recordingId: rec.recordingId, peerId, source }, 'Could not start segment');
  }
}

/**
 * syncPeer(rec, peerId)
 *
 * Purpose: look at the peer's producers RIGHT NOW and reconcile both segments.
 *
 * STEP 1: Get the peer. If the peer is gone, the producer list is empty,
 *         so reconcile() will stop the segments.
 *
 * STEP 2: Keep only producers that are still open.
 *
 * STEP 3: camera + mic go into the "camera" segment, screen goes into "screen".
 *
 * STEP 4: Reconcile both. Skip everything if the recording is already stopping.
 */
async function syncPeer(rec: ActiveRecording, peerId: string): Promise<void> {
  if (rec.stopping) return;                                                     // STEP 4

  const peer = getPeer(rec.roomId, peerId);                                     // STEP 1
  const live = peer ? [...peer.producers.values()].filter((p) => !p.closed) : []; // STEP 2

  const camera = live.filter((p) => p.appData.source === 'camera' || p.appData.source === 'mic'); // STEP 3
  const screen = live.filter((p) => p.appData.source === 'screen');

  await reconcile(rec, peerId, 'camera', camera);                               // STEP 4
  await reconcile(rec, peerId, 'screen', screen);
}

/**
 * startRecording(roomId, recordingId)
 *
 * Purpose: begin recording a room.
 *
 * STEP 1: Check recordingId is safe. It becomes a folder name,
 *         so only letters, numbers, "-" and "_" are allowed.
 *
 * STEP 2: Room must exist (getRouter throws 404 if not).
 *
 * STEP 3: One recording per room. A second start gives 409.
 *         This check comes AFTER the await, so two requests at the same
 *         moment cannot both pass.
 *
 * STEP 4: Create /recordings/<recordingId>/raw on the shared volume.
 *
 * STEP 5: Register the recording.
 *
 * STEP 6: Start segments for peers who are already in the room.
 *
 * @returns recordingId and the start time.
 */
export async function startRecording(
  roomId: string,
  recordingId: string,
): Promise<{ recordingId: string; startedAtMs: number }> {
  // STEP 1
  if (!/^[\w-]{1,128}$/.test(recordingId)) {
    throw new AppError('Invalid recordingId', 400);
  }

  // STEP 2
  await getRouter(roomId);

  // STEP 3
  if (recordings.has(roomId)) {
    throw new AppError('Room is already being recorded', 409);
  }

  // STEP 4
  await mkdir(path.join(recordingDirOf(recordingId), 'raw'), { recursive: true });

  // STEP 5
  if (recordings.has(roomId)) {
    throw new AppError('Room is already being recorded', 409); // lost a race during mkdir
  }
  const rec: ActiveRecording = {
    recordingId,
    roomId,
    startedAtMs: Date.now(),
    nextIndex: 0,
    active: new Map(),
    finished: [],
    timers: new Map(),
    crashes: new Map(),
    queue: Promise.resolve(),
    stopping: false,
  };
  recordings.set(roomId, rec);

  // STEP 6
  await Promise.all(listPeerIds(roomId).map((id) => enqueue(rec, () => syncPeer(rec, id))));

  logger.info({ roomId, recordingId }, 'Recording started');
  return { recordingId, startedAtMs: rec.startedAtMs };
}

/**
 * stopRecording(roomId, reason)
 *
 * Purpose: end the recording and tell recording-service.
 *
 * STEP 1: No recording for this room -> return undefined (idempotent).
 *
 * STEP 2: Remove it from the map and set "stopping" RIGHT AWAY,
 *         so no new events can feed it.
 *
 * STEP 3: Cancel all debounce timers.
 *
 * STEP 4: Inside the queue (so earlier work finishes first), stop every
 *         running segment in parallel.
 *
 * STEP 5: Build the manifest from all finished segments, sorted by index.
 *
 * STEP 6: Call finishRecording() in the BACKGROUND (no await).
 *         It never throws, and a slow recording-service must not slow the SFU.
 *
 * @param reason - 'stopped' | 'room-empty' | ...
 */
export async function stopRecording(
  roomId: string,
  reason: string,
): Promise<{ recordingId: string; segmentCount: number } | undefined> {
  // STEP 1
  const rec = recordings.get(roomId);
  if (!rec) return undefined;

  // STEP 2
  recordings.delete(roomId);
  rec.stopping = true;

  // STEP 3
  for (const t of rec.timers.values()) clearTimeout(t);
  rec.timers.clear();

  // STEP 4 + 5
  const manifest = await enqueue(rec, async (): Promise<Manifest> => {
    await Promise.all([...rec.active.keys()].map((key) => endSegment(rec, key)));
    return {
      recordingId: rec.recordingId,
      roomId: rec.roomId,
      reason,
      recordingStartedAtMs: rec.startedAtMs,
      recordingEndedAtMs: Date.now(),
      segments: [...rec.finished].sort((a, b) => a.index - b.index),
    };
  });

  // STEP 6
  void finishRecording(manifest);

  logger.info({ roomId, recordingId: rec.recordingId, reason, segments: manifest.segments.length }, 'Recording stopped');
  return { recordingId: rec.recordingId, segmentCount: manifest.segments.length };
}

/**
 * notifyProducersChanged(roomId, peerId)
 *
 * Purpose: called when a peer produces something or a producer closes.
 *
 * STEP 1: Not recording this room -> ignore.
 *
 * STEP 2: Restart the peer's debounce timer. Many quick changes
 *         (camera, then mic) become ONE sync.
 *
 * STEP 3: When the timer fires, queue a sync for that peer.
 */
export function notifyProducersChanged(roomId: string, peerId: string): void {
  const rec = recordings.get(roomId);                         // STEP 1
  if (!rec || rec.stopping) return;

  const old = rec.timers.get(peerId);                         // STEP 2
  if (old) clearTimeout(old);

  rec.timers.set(peerId, setTimeout(() => {                   // STEP 3
    rec.timers.delete(peerId);
    enqueue(rec, () => syncPeer(rec, peerId)).catch(() => undefined);
  }, SYNC_DELAY_MS));
}

/**
 * notifyPeerLeft(roomId, peerId)
 *
 * Purpose: called AFTER removePeer() when a peer leaves or disconnects.
 *
 * STEP 1: Not recording this room -> ignore.
 *
 * STEP 2: Cancel the peer's pending timer and sync NOW (no delay),
 *         so the peer's segments are closed.
 *
 * STEP 3: If nobody is left in the room, stop the recording
 *         with reason "room-empty".
 *
 * Never throws: a recording problem must not break "leave".
 */
export async function notifyPeerLeft(roomId: string, peerId: string): Promise<void> {
  try {
    const rec = recordings.get(roomId);                       // STEP 1
    if (!rec || rec.stopping) return;

    const t = rec.timers.get(peerId);                         // STEP 2
    if (t) { clearTimeout(t); rec.timers.delete(peerId); }
    await enqueue(rec, () => syncPeer(rec, peerId));

    if (getPeerCount(roomId) === 0) {                         // STEP 3
      await stopRecording(roomId, 'room-empty');
    }
  } catch (err) {
    logger.error({ err, roomId, peerId }, 'notifyPeerLeft failed');
  }
}

/** True if this room is being recorded right now. */
export function isRecording(roomId: string): boolean {
  return recordings.has(roomId);
}

/** The recordingId of this room's running recording, if any. */
export function getRecordingId(roomId: string): string | undefined {
  return recordings.get(roomId)?.recordingId;
}