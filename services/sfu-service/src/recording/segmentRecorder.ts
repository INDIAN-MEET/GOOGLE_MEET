import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type * as mediasoup from 'mediasoup';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';
import { buildSdp } from './sdp.ts';
import type { SdpMedia } from './sdp.ts';
import { allocPort, freePort } from './ports.ts';

/** 'camera' = camera video + mic audio together. 'screen' = a screen share. */
export type SegmentSource = 'camera' | 'screen';

/**
 * The handle we give back to the caller (the recording manager in 10.3.4).
 * It describes a running segment and has one method: stop().
 */
export interface ActiveSegment {
  index: number;            // order of this segment inside the recording
  peerId: string;           // socket id of the person
  userId?: string;          // real user id (from producer.appData, Step 10.2)
  source: SegmentSource;
  hasVideo: boolean;
  hasAudio: boolean;
  producerIds: string[];    // used later to detect "did this peer's producers change?"
  file: string;             // full path of the .mkv file
  startedAtMs: number;      // when media actually started flowing
  stop(): Promise<{ endedAtMs: number }>;
}

/** Everything startSegment() needs from the caller. */
export interface StartSegmentOptions {
  router: mediasoup.types.Router;
  dir: string;                           // /recordings/<recordingId>/raw
  index: number;
  peerId: string;
  userId?: string;
  source: SegmentSource;
  producers: mediasoup.types.Producer[]; // the tracks to record
  onUnexpectedExit?: () => void;         // called if FFmpeg dies without us asking
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * startSegment(opts)
 *
 * Purpose: record one peer's tracks (or one screen share) into one MKV file.
 *
 * STEP 1: For every producer: take a free port, create a PlainTransport,
 *         connect it to 127.0.0.1:<port>, and create a PAUSED consumer.
 *         Consume with router.rtpCapabilities so the codec stays exactly
 *         what the browser sent (no transcoding in the SFU).
 *
 * STEP 2: Write the SDP file, then start FFmpeg in copy mode into an MKV file.
 *
 * STEP 3: Wait 800 ms so FFmpeg has opened its UDP ports. If FFmpeg already
 *         died, stop here with an error. Otherwise resume the consumers.
 *
 * STEP 4: Ask for a key frame now and every 10 seconds.
 *
 * STEP 5: Return a handle. stop() is idempotent: SIGINT, wait (max 10 s),
 *         SIGKILL, close consumers and transports, free the ports.
 *
 * On any error before the handle is returned, everything is cleaned up.
 */
export async function startSegment(opts: StartSegmentOptions): Promise<ActiveSegment> {
  const { router, dir, index, peerId, userId, source, producers } = opts;

  // Everything we create is remembered here, so closeAll() can undo it.
  const parts: {
    kind: 'audio' | 'video';
    port: number;
    transport: mediasoup.types.PlainTransport;
    consumer: mediasoup.types.Consumer;
  }[] = [];
  let ff: ChildProcess | undefined;

  // Closes every consumer and transport and gives the ports back.
  // try/catch because mediasoup may already have closed them (for example when the Router closes).
  const closeAll = () => {
    for (const p of parts) {
      try { p.consumer.close(); } catch { /* already closed */ }
      try { p.transport.close(); } catch { /* already closed */ }
      freePort(p.port);
    }
    parts.length = 0;
  };

  try {
    // STEP 1: one port + one PlainTransport + one paused consumer per producer
    for (const producer of producers) {
      const port = allocPort();
      let transport: mediasoup.types.PlainTransport | undefined;
      try {
        transport = await router.createPlainTransport({
          listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, // local only, never exposed outside the container
          rtcpMux: true,    // RTP and RTCP on one port (matches "a=rtcp-mux" in the SDP)
          comedia: false,   // we tell it where to send; it does not wait for FFmpeg to talk first
        });
        await transport.connect({ ip: '127.0.0.1', port }); // send the RTP to FFmpeg's port

        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities: router.rtpCapabilities, // keep the original codec, no transcoding
          paused: true,                            // do not send yet, FFmpeg is not ready
        });
        parts.push({ kind: producer.kind, port, transport, consumer });
      } catch (err) {
        // this track failed before it was added to "parts", so clean it up here
        transport?.close();
        freePort(port);
        throw err; // the outer catch cleans up the tracks that already succeeded
      }
    }

    // STEP 2: SDP file + FFmpeg process
    const base = path.join(dir, `${index}-${peerId}-${source}`); // e.g. 0-abc123-camera
    const sdpPath = `${base}.sdp`;
    const file = `${base}.mkv`;

    // The SDP is built from the REAL consumer parameters, so it always matches what is sent
    const medias: SdpMedia[] = parts.map((p) => ({
      kind: p.kind,
      port: p.port,
      rtpParameters: p.consumer.rtpParameters,
    }));
    await writeFile(sdpPath, buildSdp(medias));

    let stopping = false;                      // true once WE asked FFmpeg to stop
    let markExited!: () => void;
    const exited = new Promise<void>((resolve) => { markExited = resolve; }); // resolves when FFmpeg is gone

    ff = spawn(
      env.ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'warning',
        '-protocol_whitelist', 'file,udp,rtp', // FFmpeg refuses to read a local SDP + UDP without this
        '-fflags', '+genpts',                  // generate timestamps if packets arrive without them
        '-i', sdpPath,                         // input: the SDP file
        '-c', 'copy',                          // do NOT re-encode, just copy packets
        '-f', 'matroska',                      // MKV container
        '-y', file,                            // output file (overwrite)
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }, // we only read stderr (warnings and errors)
    );
    const proc = ff;

    proc.stderr?.on('data', (d) => logger.warn({ peerId, ffmpeg: String(d).trim() }, 'ffmpeg'));
    proc.once('exit', () => {
      markExited();
      if (!stopping) opts.onUnexpectedExit?.(); // FFmpeg died on its own: tell the manager
    });
    proc.once('error', (err) => {               // for example "ffmpeg: command not found"
      logger.error({ err, peerId }, 'ffmpeg process error');
      markExited();
      if (!stopping) opts.onUnexpectedExit?.();
    });

    // STEP 3: give FFmpeg time to open its ports, then let the media flow
    await sleep(800);
    if (proc.exitCode !== null) throw new Error('ffmpeg exited right after start'); // bad SDP etc.
    for (const p of parts) await p.consumer.resume();
    const startedAtMs = Date.now(); // the real start of this segment (used for startOffsetMs later)

    // STEP 4: key frames, so the file has a good first frame and can be seeked
    const askKeyFrames = () => {
      for (const p of parts) {
        if (p.kind === 'video') p.consumer.requestKeyFrame().catch(() => undefined);
      }
    };
    askKeyFrames();
    const keyTimer = setInterval(askKeyFrames, 10_000);

    // STEP 5: the handle returned to the caller
    let stopPromise: Promise<{ endedAtMs: number }> | undefined;

    return {
      index, peerId, userId, source,
      hasVideo: parts.some((p) => p.kind === 'video'),
      hasAudio: parts.some((p) => p.kind === 'audio'),
      producerIds: producers.map((p) => p.id),
      file,
      startedAtMs,
      stop() {
        // "??=" means: create the promise only the first time. A second call gets the same promise.
        stopPromise ??= (async () => {
          stopping = true;            // so the "exit" event does not count as a crash
          clearInterval(keyTimer);
          const endedAtMs = Date.now();

          if (proc.exitCode === null) {                       // FFmpeg still running
            proc.kill('SIGINT');                              // polite: finish the file properly
            const killTimer = setTimeout(() => proc.kill('SIGKILL'), 10_000); // fallback if it hangs
            await exited;
            clearTimeout(killTimer);
          }

          closeAll(); // consumers, transports, ports
          return { endedAtMs };
        })();
        return stopPromise;
      },
    };
  } catch (err) {
    ff?.kill('SIGKILL'); // setup failed: leave nothing running
    closeAll();
    throw err;
  }
}