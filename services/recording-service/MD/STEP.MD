
# Phase 10 — Recording Service: Step-by-Step Build Guide

> **What this file is:** the full build guide, from the first command to the last test.
> **Format of every step:** **Why** (the reason) → **How it works** (the idea) → **Code** (file location + STEP comments) → **Done when** (how you know it works).
> **Companion file:** `phase-10-recording-service.md` has the design decisions, API contracts and diagrams. This file has the code and the order of work. Where the two differ, **this file wins** (see section 1.3).

---

## 0. Quick facts

| Item                             | Value                                                                                       |
| :------------------------------- | :------------------------------------------------------------------------------------------ |
| New service folder               | `services/recording-service` (port `4007`)                                              |
| SFU additions                    | `services/sfu-service/src/recording/`                                                     |
| Branch                           | `phase-10-recording-service`                                                              |
| This file                        | `md/phase-10-recording-service-build-guide.md`                                            |
| Database                         | Postgres`recording_db`                                                                    |
| Queue                            | BullMQ on the existing Redis                                                                |
| Shared volume                    | `recordings_data` mounted at `/recordings` in `sfu-service` and `recording-service` |
| Public URL (through the gateway) | `/v1/recordings/*`                                                                        |
| Redis channel                    | `recording-events`                                                                        |
| Redis lock key                   | `recording:active:{roomCode}`                                                             |

---

## 1. Read this first

### 1.1 The idea in one minute

- The **SFU** already receives every participant's media. It copies the raw RTP packets to **FFmpeg** (copy mode, almost no CPU). FFmpeg writes `.mkv` files.
- The **recording-service** decides who may record, keeps the database rows, and runs a **BullMQ worker** that converts the `.mkv` files to `.mp4`.
- **Signaling** tells everyone in the room when recording starts, stops, and is ready.
- The frontend (Phase F) will only call REST endpoints and listen to socket events.

### 1.2 Progress tracker

| Step | What                                                                    |              Status              |
| :---: | :---------------------------------------------------------------------- | :-------------------------------: |
| 10.0 | Merge Phase 9, create the branch                                        |              ✅ Done              |
| 10.1 | Infra:`recording_db`, FFmpeg in the SFU image, `/recordings` volume |              ✅ Done              |
| 10.2 | `userId` in SFU producers                                             |              ✅ Done              |
| 10.3 | SFU recorder module                                                     |              ✅ Done              |
| 10.4 | Test the SFU recorder alone                                             |                ⏳                |
| 10.5 | recording-service: skeleton, database, start/stop API, webhook          |                ⏳                |
| 10.6 | BullMQ finalize worker (MKV → MP4)                                     |                ⏳                |
| 10.7 | Storage and download                                                    |                ⏳                |
| 10.8 | Gateway proxy                                                           |                ⏳                |
| 10.9 | Signaling recording events                                              |                ⏳                |
| 10.10 | Compose and end-to-end test                                             |                ⏳                |
| 10.11 | Hardening (auto stop, recovery, cleanup, disk guard)                    |                ⏳                |

### 1.3 Changes compared with the first guide (this file wins)

| Topic                | First guide                     | This file                               | Why                                                                                   |
| :------------------- | :------------------------------ | :-------------------------------------- | :------------------------------------------------------------------------------------ |
| Public URL           | `/api/v1/recordings`          | `/v1/recordings`                      | Your gateway passes`/v1/rooms` through without a rewrite, so recordings do the same |
| Status columns       | Prisma enums                    | Plain`String` + a TypeScript type     | Does not depend on where your Prisma version generates enums                          |
| Thumbnails           | In the worker                   | Removed from the MVP                    | Keeps the first version small. Listed under "Later"                                   |
| `sizeBytes`        | `Int`                         | `BigInt`                              | A long screen share can pass 2 GB                                                     |
| BullMQ connection    | `IORedis` instance            | Plain connection options                | BullMQ ships its own ioredis, and a different version can break types                 |
| Cleanup and recovery | Repeatable BullMQ jobs          | `setInterval` in the service          | One service instance, fewer moving parts. Move to BullMQ schedulers in Phase 15       |
| Router lookup        | `startRecording(roomId, ...)` | `startRecording(router, roomId, ...)` | Avoids an import cycle between the recorder and`roomManager`                        |

### 1.4 Assumptions to verify (about your code)

- Room Service returns the host as **`room.hostUserId`** and `GET /v1/rooms/:code` returns `{ data: { room } }`.
- Your Prisma setup follows the "Prisma 7 pattern" (no `url` in `schema.prisma`, a `prisma.config.ts`, the `PrismaPg` adapter in a `db.ts`). **Copy those files from room-service. This guide only supplies the models and the queries.**
- recording-service uses `.js` import endings (like room-service and signaling). The SFU keeps `.ts` endings.

---

## 2. Big picture

```mermaid
flowchart LR
    Host["Host browser"] --> GW["Gateway :4000"] --> Rec["recording-service :4007<br/>REST + BullMQ worker"]
    Rec -- "host check" --> Room["room-service :4003"]
    Rec -- "start / stop" --> SFU["sfu-service :4006<br/>PlainTransport + FFmpeg copy"]
    SFU -- "raw .mkv + manifest.json" --> Vol[("/recordings")]
    SFU -- "capture-ended webhook" --> Rec
    Rec -- "mkv to mp4" --> Vol
    Rec <--> PG[("recording_db")]
    Rec <--> Redis[("Redis: lock, queue, events")]
    Redis --> Sig["signaling :4004"] --> Peers["Everyone in the room"]
```

### 2.1 Where each step puts its code

| Step | New files                                                                                                                                       | Edited files                                                                                                            |
| :---: | :---------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| 10.1 | none                                                                                                                                            | `Dockerfile` (SFU), `env.ts` (SFU), `docker-compose.yml`, `infra/postgres-init/init.sql`                        |
| 10.2 | none                                                                                                                                            | signaling`sfuClient.ts`, `handlers/sfu.ts`; SFU `sfuSchemas.ts`, `produceController.ts`, `producerManager.ts` |
| 10.3 | SFU`recording/ports.ts`, `sdp.ts`, `segmentRecorder.ts`, `manifest.ts`, `recordingManager.ts`, `controllers/recordingController.ts` | SFU`peerManager.ts`, `producerManager.ts`, `roomManager.ts`, `sfuRoutes.ts`, `sfuSchemas.ts`                  |
| 10.4 | none                                                                                                                                            | `test-client/sfu-one-click.html`                                                                                      |
| 10.5 | most of`services/recording-service/`                                                                                                          | none                                                                                                                    |
| 10.6 | `queue/finalizeWorker.ts`, `processing/*`                                                                                                   | `server.ts`                                                                                                           |
| 10.7 | `storage/*`                                                                                                                                   | `recordingController.ts`                                                                                              |
| 10.8 | none                                                                                                                                            | gateway proxy routes, gateway env                                                                                       |
| 10.9 | signaling`events/recordingEvents.ts`, `tests/manual/recording.client.ts`                                                                    | signaling`socket/index.ts`, `handlers/joinRoom.ts`                                                                  |
| 10.10 | none                                                                                                                                            | `docker-compose.yml`                                                                                                  |
| 10.11 | `services/recovery.ts`, `services/cleanup.ts`, `utils/disk.ts`, `queue/controlWorker.ts`                                                | `recordingController.ts`, `server.ts`                                                                               |

---

# PART A: SFU side (Steps 10.1 to 10.4)

---

## Step 10.1: Infra preparation ✅ done

**Why**

- FFmpeg must exist inside the SFU container, and the SFU must be able to write files that recording-service can read.

**How it works**

- A Docker **named volume** (`recordings_data`) is mounted at `/recordings` in both containers.
- A new named volume copies the owner of the image folder, so `/recordings` is created with `chown node:node` in the image. Otherwise the `node` user cannot write.
- FFmpeg RTP ports (`50000-50200`) are on loopback inside the container and must **not** overlap the mediasoup range (`40000-40100`).

**Code (recap)**

**File:** `infra/postgres-init/init.sql`

```sql
CREATE DATABASE auth_db;
CREATE DATABASE user_db;
CREATE DATABASE room_db;
CREATE DATABASE recording_db;
```

**File:** `services/sfu-service/Dockerfile` (runtime stage, before `USER node`)

```dockerfile
# STEP: FFmpeg for recording, used in "-c copy" mode only
# STEP: /recordings must belong to "node" because the container runs as that user
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /recordings \
    && chown node:node /recordings
```

**File:** `services/sfu-service/src/config/env.ts` (keys added to the `env` object)

```typescript
recordingDir: process.env.RECORDING_DIR || '/recordings',
recordingServiceUrl: process.env.RECORDING_SERVICE_URL || 'http://recording-service:4007',
recordingRtpMin: Number(process.env.RECORDING_RTP_MIN_PORT) || 50000,
recordingRtpMax: Number(process.env.RECORDING_RTP_MAX_PORT) || 50200,
ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
```

**Done when**

- `docker compose exec sfu-service ffmpeg -version` prints a version.
- `docker compose exec sfu-service sh -c "touch /recordings/t && ls -l /recordings && rm /recordings/t"` works.

---

## Step 10.2: `userId` in SFU producers ✅ done

**Why**

- Files must say which **person** they belong to. The SFU only knows `socket.id`, which changes on every connection.

**How it works**

- Signaling reads `socket.data.userId` (from the verified JWT) and sends it with each `produce` call. The SFU stores it in `producer.appData.userId`. The recorder reads it later.
- The browser can never set it. The field is optional, so nothing breaks without it.

**Code (recap, 5 edits)**

| File                                                 | Change                                                                    |
| :--------------------------------------------------- | :------------------------------------------------------------------------ |
| `signaling-service/src/config/sfuClient.ts`        | `produce(..., userId?)` and `userId` in the body                      |
| `signaling-service/src/handlers/sfu.ts`            | pass`socket.data.userId as string`                                      |
| `sfu-service/src/validation/sfuSchemas.ts`         | `userId: Joi.string().trim().max(128).optional()` in `produceSchema`  |
| `sfu-service/src/controllers/produceController.ts` | read`userId`, pass `typeof userId === 'string' ? userId : undefined`  |
| `sfu-service/src/mediasoup/producerManager.ts`     | `createProducer(..., userId?)`, `appData: { peerId, source, userId }` |

**Done when**

- `sfu-one-click.html` Parts 1 to 3 stay green and `sfu.client.ts` gives 10/10.
- `docker compose logs sfu-service | findstr "Producer created"` shows `"userId":"user-a"`.

---

## Step 10.3: SFU recorder module

Six sub-steps, one file each. Build them in this order and run `npx tsc --noEmit` after each.

### Step 10.3.1: Ports and SDP

**Why**

- FFmpeg listens on one UDP port per track. Something must hand out free ports and take them back.
- FFmpeg cannot read raw RTP by itself. It needs a small SDP text file that says which port, codec, and payload type to expect.

**How it works**

- `ports.ts` gives out **even** ports only, so a possible `port + 1` (RTCP) is never used by another track.
- `sdp.ts` builds the SDP from the real `consumer.rtpParameters`, so it always matches what mediasoup sends. It skips the `rtx` codec and writes `a=rtcp-mux` to match `rtcpMux: true`.

**Code**

**File:** `services/sfu-service/src/recording/ports.ts` (new)

```typescript
import { env } from '../config/env.ts';

/**
 * ports.ts
 *
 * STEP 1: Keep a Set of ports in use, taken from recordingRtpMin .. recordingRtpMax.
 *         This range must NOT overlap RTC_MIN_PORT .. RTC_MAX_PORT.
 *
 * STEP 2: Hand out EVEN ports only (50000, 50002, ...). Some FFmpeg versions
 *         also open "port + 1" for RTCP, so odd ports stay free.
 *
 * STEP 3: allocPort() returns the first free port, or throws when the pool is empty.
 *
 * STEP 4: freePort() puts a port back. Calling it twice is harmless.
 *
 * STEP 5: portsInUse() is a helper for tests ("are all ports freed after stop?").
 */
const used = new Set<number>();                                          // STEP 1

const start = env.recordingRtpMin % 2 === 0 ? env.recordingRtpMin : env.recordingRtpMin + 1;   // STEP 2

export function allocPort(): number {                                    // STEP 3
  for (let port = start; port <= env.recordingRtpMax; port += 2) {
    if (!used.has(port)) {
      used.add(port);
      return port;
    }
  }
  throw new Error('No free recording RTP port');
}

export function freePort(port: number): void {                           // STEP 4
  used.delete(port);
}

export function portsInUse(): number {                                   // STEP 5
  return used.size;
}
```

**File:** `services/sfu-service/src/recording/sdp.ts` (new)

```typescript
import type * as mediasoup from 'mediasoup';

export interface SdpMedia {
  kind: 'audio' | 'video';
  port: number;                                   // the UDP port FFmpeg will listen on
  rtpParameters: mediasoup.types.RtpParameters;   // from consumer.rtpParameters
}

/**
 * buildSdp(medias)
 *
 * STEP 1: Write the session header. Everything stays on 127.0.0.1
 *         because FFmpeg runs in the same container as the SFU.
 *
 * STEP 2: Write one "m=" section per consumer (audio and/or video).
 *         "a=rtcp-mux" matches rtcpMux: true on the PlainTransport.
 *
 * STEP 3: Use the first codec that is NOT rtx. Its payload type, clock rate
 *         (and channels for audio) must be exactly what mediasoup sends.
 *
 * STEP 4: Copy the codec parameters into "a=fmtp". H264 needs them.
 *
 * No a=sendonly / a=recvonly line on purpose: it adds risk and no benefit.
 */
export function buildSdp(medias: SdpMedia[]): string {
  // STEP 1
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=mediasoup-recording',
    'c=IN IP4 127.0.0.1',
    't=0 0',
  ];

  for (const m of medias) {
    // STEP 3
    const codec = m.rtpParameters.codecs.find((c) => !/\/rtx$/i.test(c.mimeType));
    if (!codec) throw new Error(`No usable codec for ${m.kind}`);

    const name = codec.mimeType.split('/')[1];
    const pt = codec.payloadType;
    const channels = m.kind === 'audio' && codec.channels ? `/${codec.channels}` : '';

    // STEP 2
    lines.push(`m=${m.kind} ${m.port} RTP/AVP ${pt}`);
    lines.push('a=rtcp-mux');
    lines.push(`a=rtpmap:${pt} ${name}/${codec.clockRate}${channels}`);

    // STEP 4
    const fmtp = Object.entries(codec.parameters ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    if (fmtp) lines.push(`a=fmtp:${pt} ${fmtp}`);
  }

  return lines.join('\n') + '\n';
}
```

**Done when**

- A throwaway script printing `buildSdp` for a fake VP8 + rtx + Opus input shows the VP8 and Opus sections and **no** payload type for rtx.
- `npx tsc --noEmit` is clean.
- Commit: `phase-10: step 3a recording ports and sdp helpers`

---

### Step 10.3.2: One segment (PlainTransport, FFmpeg, clean stop)

**Why**

- This is the core: take one peer's tracks, send them to FFmpeg, and end the file safely.

**How it works**

- A **segment** = one peer's camera + mic together (one SDP, so FFmpeg keeps lip-sync using RTCP), or one screen share.
- For each producer: one `PlainTransport` (one remote port each) → one **paused** consumer.
- Start FFmpeg first, **wait 800 ms** so its UDP ports are open, then resume the consumers. Resuming earlier loses the first packets.
- Ask for a key frame at the start and every 10 seconds.
- Stop with `SIGINT` (FFmpeg writes the end of the file), wait for exit, `SIGKILL` after 10 s as a fallback. Then close consumers and transports and free the ports.
- If FFmpeg dies by itself, a callback tells the manager.

**Code**

**File:** `services/sfu-service/src/recording/segmentRecorder.ts` (new)

```typescript
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

export type SegmentSource = 'camera' | 'screen';

export interface ActiveSegment {
  index: number;
  peerId: string;
  userId?: string;
  source: SegmentSource;
  hasVideo: boolean;
  hasAudio: boolean;
  producerIds: string[];
  file: string;
  startedAtMs: number;
  stop(): Promise<{ endedAtMs: number }>;
}

export interface StartSegmentOptions {
  router: mediasoup.types.Router;
  dir: string;                           // /recordings/<recordingId>/raw
  index: number;
  peerId: string;
  userId?: string;
  source: SegmentSource;
  producers: mediasoup.types.Producer[];
  onUnexpectedExit?: () => void;         // FFmpeg died without us asking
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * startSegment(opts)
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

  const parts: {
    kind: 'audio' | 'video';
    port: number;
    transport: mediasoup.types.PlainTransport;
    consumer: mediasoup.types.Consumer;
  }[] = [];
  let ff: ChildProcess | undefined;

  const closeAll = () => {
    for (const p of parts) {
      try { p.consumer.close(); } catch { /* already closed */ }
      try { p.transport.close(); } catch { /* already closed */ }
      freePort(p.port);
    }
    parts.length = 0;
  };

  try {
    // STEP 1
    for (const producer of producers) {
      const port = allocPort();
      let transport: mediasoup.types.PlainTransport | undefined;
      try {
        transport = await router.createPlainTransport({
          listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
          rtcpMux: true,
          comedia: false,
        });
        await transport.connect({ ip: '127.0.0.1', port });

        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities: router.rtpCapabilities,
          paused: true,
        });
        parts.push({ kind: producer.kind, port, transport, consumer });
      } catch (err) {
        transport?.close();
        freePort(port);
        throw err;
      }
    }

    // STEP 2
    const base = path.join(dir, `${index}-${peerId}-${source}`);
    const sdpPath = `${base}.sdp`;
    const file = `${base}.mkv`;

    const medias: SdpMedia[] = parts.map((p) => ({
      kind: p.kind,
      port: p.port,
      rtpParameters: p.consumer.rtpParameters,
    }));
    await writeFile(sdpPath, buildSdp(medias));

    let stopping = false;
    let markExited!: () => void;
    const exited = new Promise<void>((resolve) => { markExited = resolve; });

    ff = spawn(
      env.ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'warning',
        '-protocol_whitelist', 'file,udp,rtp',
        '-fflags', '+genpts',
        '-i', sdpPath,
        '-c', 'copy',
        '-f', 'matroska',
        '-y', file,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const proc = ff;

    proc.stderr?.on('data', (d) => logger.warn({ peerId, ffmpeg: String(d).trim() }, 'ffmpeg'));
    proc.once('exit', () => {
      markExited();
      if (!stopping) opts.onUnexpectedExit?.();
    });
    proc.once('error', (err) => {
      logger.error({ err, peerId }, 'ffmpeg process error');
      markExited();
      if (!stopping) opts.onUnexpectedExit?.();
    });

    // STEP 3
    await sleep(800);
    if (proc.exitCode !== null) throw new Error('ffmpeg exited right after start');
    for (const p of parts) await p.consumer.resume();
    const startedAtMs = Date.now();

    // STEP 4
    const askKeyFrames = () => {
      for (const p of parts) {
        if (p.kind === 'video') p.consumer.requestKeyFrame().catch(() => undefined);
      }
    };
    askKeyFrames();
    const keyTimer = setInterval(askKeyFrames, 10_000);

    // STEP 5
    let stopPromise: Promise<{ endedAtMs: number }> | undefined;

    return {
      index, peerId, userId, source,
      hasVideo: parts.some((p) => p.kind === 'video'),
      hasAudio: parts.some((p) => p.kind === 'audio'),
      producerIds: producers.map((p) => p.id),
      file,
      startedAtMs,
      stop() {
        stopPromise ??= (async () => {
          stopping = true;
          clearInterval(keyTimer);
          const endedAtMs = Date.now();

          if (proc.exitCode === null) {
            proc.kill('SIGINT');
            const killTimer = setTimeout(() => proc.kill('SIGKILL'), 10_000);
            await exited;
            clearTimeout(killTimer);
          }

          closeAll();
          return { endedAtMs };
        })();
        return stopPromise;
      },
    };
  } catch (err) {
    ff?.kill('SIGKILL');
    closeAll();
    throw err;
  }
}
```

**Done when**

- `npx tsc --noEmit` is clean. (If `listenInfo` is rejected, check `createPlainTransport` in `node_modules/mediasoup`'s types. Your version is 3.27.)
- Commit: `phase-10: step 3b segment recorder`

---

### Step 10.3.3: Manifest and webhook

**Why**

- When capture ends, recording-service must learn which files exist. The **webhook** is the fast path, and `manifest.json` on disk is the **backup** if recording-service is down.

**How it works**

- First write `/recordings/<id>/manifest.json`, then `POST` the same body to recording-service with `x-internal-secret`.
- The webhook is retried 3 times (1 s, 3 s, 9 s). After that it only logs. The manifest stays, and recovery (Step 10.11) picks it up.
- The webhook never blocks or breaks the SFU.

**Code**

**File:** `services/sfu-service/src/recording/manifest.ts` (new)

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

export interface ManifestSegment {
  index: number;
  peerId: string;
  userId?: string;
  source: 'camera' | 'screen';
  hasVideo: boolean;
  hasAudio: boolean;
  file: string;
  startedAtMs: number;
  endedAtMs: number;
}

export interface Manifest {
  recordingId: string;
  roomId: string;
  reason: string;                      // 'stopped' | 'room-empty' | ...
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
  segments: ManifestSegment[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function recordingDirOf(recordingId: string): string {
  return path.join(env.recordingDir, recordingId);
}

/**
 * finishRecording(manifest)
 *
 * STEP 1: Write manifest.json (the backup). If this fails, log it and carry on.
 *
 * STEP 2: POST the same body to recording-service. First try right away,
 *         then retry after 1 s, 3 s and 9 s. Each try has a 5 s timeout.
 *
 * STEP 3: If every try fails, only log it. The manifest is on disk,
 *         and recording-service recovers it on boot (Step 10.11).
 */
export async function finishRecording(manifest: Manifest): Promise<void> {
  // STEP 1
  try {
    await mkdir(recordingDirOf(manifest.recordingId), { recursive: true });
    await writeFile(
      path.join(recordingDirOf(manifest.recordingId), 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch (err) {
    logger.error({ err, recordingId: manifest.recordingId }, 'Could not write manifest.json');
  }

  // STEP 2
  const url = `${env.recordingServiceUrl}/internal/recordings/${manifest.recordingId}/capture-ended`;
  for (const wait of [0, 1000, 3000, 9000]) {
    if (wait) await sleep(wait);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': env.internalSecret },
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        logger.info({ recordingId: manifest.recordingId }, 'capture-ended webhook delivered');
        return;
      }
      logger.warn({ recordingId: manifest.recordingId, status: res.status }, 'capture-ended webhook rejected');
    } catch (err) {
      logger.warn({ recordingId: manifest.recordingId, err: String(err) }, 'capture-ended webhook failed');
    }
  }

  // STEP 3
  logger.error({ recordingId: manifest.recordingId }, 'capture-ended webhook gave up, manifest stays on disk');
}
```

**Done when**

- `npx tsc --noEmit` is clean.
- Commit: `phase-10: step 3c manifest and webhook`

---

### Step 10.3.4: Recording manager (the brain)

**Why**

- Someone must decide **when** to start and stop segments as people join, leave, and share screens, and keep one recording state per room.

**How it works**

- One `RoomRecording` object per room that is being recorded.
- **Groups:** `camera` (the peer's camera video + mic audio) and `screen` (the screen share).
- `reconcile(peer)` compares what the peer **should** be recording (their current producers) with what is **running**. Same set → keep. Different set → stop the old segment, start a new one.
- Triggers (all debounced):
  - producer created → wait 1.5 s (camera and mic usually arrive together)
  - producer closed → wait 0.3 s
- A per-peer promise chain makes sure two reconciles for the same peer never run at the same time.
- On stop: cancel timers, wait for running reconciles, stop every segment, drop empty files, write the manifest, send the webhook.

| Situation                                             | Result                                                                                         |
| :---------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| Recording starts                                      | One`camera` segment per peer with camera and/or mic, one `screen` segment per screen share |
| Peer joins later                                      | Segment starts 1.5 s after their producers appear                                              |
| A producer of a segment closes, or a new one is added | That segment ends, a new one starts with the new set                                           |
| Peer leaves                                           | Their segments end                                                                             |
| Room empties (`closeRoom`)                          | The whole recording stops with reason`room-empty`                                            |

**Code**

**File:** `services/sfu-service/src/recording/recordingManager.ts` (new)

```typescript
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type * as mediasoup from 'mediasoup';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';
import { getPeer, listRoomPeers } from '../mediasoup/peerManager.ts';
import type { Peer } from '../mediasoup/peerManager.ts';
import { startSegment } from './segmentRecorder.ts';
import type { ActiveSegment, SegmentSource } from './segmentRecorder.ts';
import { finishRecording, recordingDirOf } from './manifest.ts';
import type { ManifestSegment } from './manifest.ts';

const GROUPS: SegmentSource[] = ['camera', 'screen'];
const DEBOUNCE_CREATED_MS = 1500;
const DEBOUNCE_CLOSED_MS = 300;

interface RoomRecording {
  recordingId: string;
  roomId: string;
  router: mediasoup.types.Router;
  startedAtMs: number;
  nextIndex: number;
  stopping: boolean;
  running: Map<string, ActiveSegment>;      // key: "<peerId>:<group>"
  finished: ManifestSegment[];
  timers: Map<string, NodeJS.Timeout>;      // per-peer debounce timer
  chains: Map<string, Promise<void>>;       // per-peer serial queue
}

const active = new Map<string, RoomRecording>();   // roomId -> state

/**
 * pickProducers(peer, group)
 *
 * STEP 1: Ignore closed producers.
 * STEP 2: "screen" group = the peer's screen producer.
 * STEP 3: "camera" group = ONE camera video + ONE mic audio (if they exist).
 *         Video first, then audio.
 */
function pickProducers(peer: Peer, group: SegmentSource): mediasoup.types.Producer[] {
  const all = [...peer.producers.values()].filter((p) => !p.closed);        // STEP 1

  if (group === 'screen') {                                                 // STEP 2
    return all.filter((p) => p.appData.source === 'screen');
  }

  const camera = all.find((p) => p.appData.source === 'camera');            // STEP 3
  const mic = all.find((p) => p.appData.source === 'mic');
  return [camera, mic].filter((p): p is mediasoup.types.Producer => !!p);
}

/**
 * endSegment(rec, key, seg)
 *
 * STEP 1: Only the first caller proceeds (stop button and "FFmpeg died" can both arrive).
 * STEP 2: Stop the segment and remember it in rec.finished for the manifest.
 */
async function endSegment(rec: RoomRecording, key: string, seg: ActiveSegment): Promise<void> {
  if (rec.running.get(key) !== seg) return;                                 // STEP 1
  rec.running.delete(key);

  const { endedAtMs } = await seg.stop();                                   // STEP 2
  rec.finished.push({
    index: seg.index,
    peerId: seg.peerId,
    userId: seg.userId,
    source: seg.source,
    hasVideo: seg.hasVideo,
    hasAudio: seg.hasAudio,
    file: seg.file,
    startedAtMs: seg.startedAtMs,
    endedAtMs,
  });
}

/**
 * beginSegment(rec, key, peerId, group, producers)
 *
 * STEP 1: Take the next index and start the segment.
 * STEP 2: If FFmpeg dies later, end the segment so the file is kept and ports are freed.
 * STEP 3: A failure here is logged, not thrown. The next reconcile can try again.
 */
async function beginSegment(
  rec: RoomRecording, key: string, peerId: string,
  group: SegmentSource, producers: mediasoup.types.Producer[],
): Promise<void> {
  const index = rec.nextIndex++;                                            // STEP 1
  const userId = producers.map((p) => p.appData.userId).find((u) => typeof u === 'string') as string | undefined;
  let seg: ActiveSegment | undefined;

  try {
    seg = await startSegment({
      router: rec.router,
      dir: path.join(recordingDirOf(rec.recordingId), 'raw'),
      index, peerId, userId, source: group, producers,
      onUnexpectedExit: () => {                                             // STEP 2
        if (seg) void endSegment(rec, key, seg).catch((err) => logger.error({ err }, 'endSegment failed'));
      },
    });
    rec.running.set(key, seg);
    logger.info({ recordingId: rec.recordingId, peerId, group, index }, 'Recording segment started');
  } catch (err) {
    logger.error({ err, recordingId: rec.recordingId, peerId, group }, 'Could not start recording segment');   // STEP 3
  }
}

/**
 * reconcile(rec, peerId)
 *
 * STEP 1: Do nothing once the recording is stopping.
 * STEP 2: The peer may be gone (left the room): then nothing is desired.
 * STEP 3: For each group, compare desired producer ids with the running segment.
 *         Same ids -> keep. Different -> end the old one.
 * STEP 4: If something is desired and nothing runs, start a new segment.
 */
async function reconcile(rec: RoomRecording, peerId: string): Promise<void> {
  if (rec.stopping) return;                                                 // STEP 1

  const peer = getPeer(rec.roomId, peerId);                                 // STEP 2

  for (const group of GROUPS) {
    const key = `${peerId}:${group}`;
    const desired = peer ? pickProducers(peer, group) : [];
    const desiredIds = desired.map((p) => p.id).sort().join(',');
    const running = rec.running.get(key);
    const runningIds = running ? [...running.producerIds].sort().join(',') : '';

    if (running && runningIds === desiredIds) continue;                     // STEP 3
    if (running) await endSegment(rec, key, running);

    if (desired.length > 0 && !rec.stopping) {                              // STEP 4
      await beginSegment(rec, key, peerId, group, desired);
    }
  }
}

/**
 * schedule(rec, peerId, delayMs)
 *
 * STEP 1: Replace any pending timer for this peer (debounce).
 * STEP 2: When it fires, append reconcile() to this peer's chain,
 *         so two reconciles for one peer never overlap.
 */
function schedule(rec: RoomRecording, peerId: string, delayMs: number): void {
  clearTimeout(rec.timers.get(peerId));                                     // STEP 1
  rec.timers.set(peerId, setTimeout(() => {
    rec.timers.delete(peerId);
    const previous = rec.chains.get(peerId) ?? Promise.resolve();           // STEP 2
    rec.chains.set(
      peerId,
      previous.then(() => reconcile(rec, peerId)).catch((err) => logger.error({ err, peerId }, 'reconcile failed')),
    );
  }, delayMs));
}

/** keepNonEmpty(list): drop segments whose file is missing or empty (stopped before any media arrived). */
async function keepNonEmpty(list: ManifestSegment[]): Promise<ManifestSegment[]> {
  const out: ManifestSegment[] = [];
  for (const s of list) {
    try {
      if ((await stat(s.file)).size > 0) { out.push(s); continue; }
    } catch { /* missing file */ }
    logger.warn({ file: s.file }, 'Dropping empty or missing segment file');
  }
  return out;
}

/**
 * startRecording(router, roomId, recordingId)
 *
 * STEP 1: One recording per room. A second start -> 409.
 * STEP 2: Create /recordings/<id>/raw.
 * STEP 3: Register the state, then reconcile every peer that is already in the room
 *         (in parallel, each start waits ~800 ms for FFmpeg).
 * STEP 4: Return how many segments are running. 0 is fine: people may start their camera later.
 */
export async function startRecording(
  router: mediasoup.types.Router, roomId: string, recordingId: string,
): Promise<{ segments: number }> {
  if (active.has(roomId)) throw new AppError('Room is already being recorded', 409);     // STEP 1

  await mkdir(path.join(recordingDirOf(recordingId), 'raw'), { recursive: true });       // STEP 2

  const rec: RoomRecording = {                                                           // STEP 3
    recordingId, roomId, router,
    startedAtMs: Date.now(),
    nextIndex: 0,
    stopping: false,
    running: new Map(),
    finished: [],
    timers: new Map(),
    chains: new Map(),
  };
  active.set(roomId, rec);

  await Promise.all(listRoomPeers(roomId).map((peer) => reconcile(rec, peer.id)));

  logger.info({ roomId, recordingId, segments: rec.running.size }, 'Recording started');
  return { segments: rec.running.size };                                                 // STEP 4
}

/**
 * stopRecording(roomId, recordingId, reason)
 *
 * STEP 1: Idempotent: unknown room, other recording id, or already stopping -> return.
 * STEP 2: Cancel all timers and wait for reconciles that are still running.
 * STEP 3: End every running segment (SIGINT, wait, close).
 * STEP 4: Forget the room, drop empty files, then write the manifest and send the webhook.
 */
export async function stopRecording(roomId: string, recordingId: string, reason = 'stopped'): Promise<void> {
  const rec = active.get(roomId);
  if (!rec || rec.recordingId !== recordingId || rec.stopping) return;                   // STEP 1
  rec.stopping = true;

  for (const t of rec.timers.values()) clearTimeout(t);                                  // STEP 2
  rec.timers.clear();
  await Promise.allSettled([...rec.chains.values()]);

  await Promise.allSettled(                                                              // STEP 3
    [...rec.running.entries()].map(([key, seg]) => endSegment(rec, key, seg)),
  );

  active.delete(roomId);                                                                 // STEP 4
  const segments = (await keepNonEmpty(rec.finished)).sort((a, b) => a.index - b.index);

  logger.info({ roomId, recordingId, reason, segments: segments.length }, 'Recording stopped');
  await finishRecording({
    recordingId, roomId, reason,
    recordingStartedAtMs: rec.startedAtMs,
    recordingEndedAtMs: Date.now(),
    segments,
  });
}

export function getRecordingStatus(roomId: string): { active: boolean; recordingId?: string; segments: number } {
  const rec = active.get(roomId);
  return rec ? { active: true, recordingId: rec.recordingId, segments: rec.running.size } : { active: false, segments: 0 };
}

/* ---------- hooks, called from existing code ---------- */

/** A producer was created. Wait 1.5 s so camera and mic can settle, then reconcile. */
export function onProducerCreated(peer: Peer, _producer: mediasoup.types.Producer): void {
  const rec = active.get(peer.roomId);
  if (rec && !rec.stopping) schedule(rec, peer.id, DEBOUNCE_CREATED_MS);
}

/** A producer closed (mute is NOT a close, leaving is). Reconcile soon so the file ends on time. */
export function onProducerClosed(peer: Peer, _producerId: string): void {
  const rec = active.get(peer.roomId);
  if (rec && !rec.stopping) schedule(rec, peer.id, DEBOUNCE_CLOSED_MS);
}

/**
 * The room's Router is closing. Stop the recording without waiting:
 * closeRoom() must stay fast, because Signaling's leave call has a 5 s timeout.
 */
export function onRoomClosed(roomId: string): void {
  const rec = active.get(roomId);
  if (!rec) return;
  void stopRecording(roomId, rec.recordingId, 'room-empty').catch((err) =>
    logger.error({ err, roomId }, 'stopRecording on room close failed'),
  );
}
```

**Done when**

- `npx tsc --noEmit` is clean (it will complain about `listRoomPeers` until Step 10.3.5, which is expected).
- Commit after 10.3.5.

---

### Step 10.3.5: Hooks in existing files

**Why**

- The recorder must hear about new producers, closed producers, and closed rooms. These are three small edits.

**How it works**

- `peerManager.listRoomPeers` lets the recorder walk all peers of a room.
- `producerManager` calls `onProducerCreated` and `onProducerClosed`.
- `roomManager.closeRoom` calls `onRoomClosed` **before** closing the Router, but does not wait for it. Closing the Router also closes the PlainTransports, which is harmless because `stop()` already handles closed objects.
- The imports go one way only (`roomManager → recordingManager`), so there is no import cycle.

**Code**

**File:** `services/sfu-service/src/mediasoup/peerManager.ts` (add this function at the bottom)

```typescript
/**
 * listRoomPeers(roomId)
 *
 * STEP 1: Return the peers of one room as an array (empty when the room is unknown).
 *         The recorder uses it at start to reconcile everyone already inside.
 */
export function listRoomPeers(roomId: string): Peer[] {
    return [...(rooms.get(roomId)?.values() ?? [])];
}
```

**File:** `services/sfu-service/src/mediasoup/producerManager.ts` (add the import at the top, and replace the whole `createProducer` function)

```typescript
import { onProducerCreated, onProducerClosed } from '../recording/recordingManager.ts';

export async function createProducer(
    peer: Peer,
    transportId: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
    source: ProducerSource,
    userId?: string,
): Promise<mediasoup.types.Producer> {
    const transport = peer.transports.get(transportId);

    if (!transport) {
        logger.error({ peerId: peer.id, transportId }, 'Transport not found');
        throw new AppError('Transport not found', 404);
    }

    if (transport.appData.direction !== 'send') {
        logger.error({ peerId: peer.id, transportId }, 'Cannot produce on a non-send transport');
        throw new AppError('Can only produce on a send transport', 400);
    }

    if (SOURCE_KIND[source] !== kind) {
        throw new AppError(`Source "${source}" requires kind "${SOURCE_KIND[source]}"`, 400);
    }

    let producer: mediasoup.types.Producer;

    try {
        producer = await transport.produce({
            kind,
            rtpParameters,
            appData: { peerId: peer.id, source, userId },
        });
    } catch (err: any) {
        logger.error({ err, peerId: peer.id, transportId }, 'transport.produce failed');
        throw new AppError('Failed to create producer (invalid rtpParameters?)', 400);
    }

    peer.producers.set(producer.id, producer);
    // Transport closed -> mediasoup closes the producer itself. Log only.
    producer.on('transportclose', () => {
        logger.info({ peerId: peer.id, producerId: producer.id }, 'Producer transport closed');
    });

    // Single place that keeps our map in sync
    producer.observer.on('close', () => {
        peer.producers.delete(producer.id);
        logger.info({ peerId: peer.id, producerId: producer.id, source }, 'Producer closed');
        onProducerClosed(peer, producer.id);                      // NEW: tell the recorder
    });

    logger.info(
        { peerId: peer.id, roomId: peer.roomId, producerId: producer.id, kind, source, userId },
        'Producer created',
    );

    onProducerCreated(peer, producer);                            // NEW: tell the recorder

    return producer;
}
```

**File:** `services/sfu-service/src/mediasoup/roomManager.ts` (add the import at the top, and replace the whole `closeRoom` function)

```typescript
import { onRoomClosed } from '../recording/recordingManager.ts';

/**
 * closeRoom(roomId)
 *
 * STEP 1: Unknown room -> nothing to do.
 * STEP 2: Delete the Router entry first, so a new join can create a fresh Router.
 * STEP 3: Tell the recorder (fire and forget). It stops FFmpeg and writes the manifest.
 * STEP 4: Close the Router.
 */
export async function closeRoom(roomId: string): Promise<void> {
  const routerPromise = routers.get(roomId)
  if (!routerPromise) return;                              // STEP 1

  routers.delete(roomId);                                  // STEP 2

  onRoomClosed(roomId);                                    // STEP 3

  try {                                                    // STEP 4
    const router = await routerPromise;
    router.close();
    logger.info({ roomId }, 'Router closed');
  } catch (err) {
    logger.warn({ err, roomId }, 'Router was already failed/closed');
  }
}
```

**Done when**

- `npx tsc --noEmit` is clean.
- `docker compose up -d --build sfu-service`, then Parts 1 to 3 of `sfu-one-click.html` are still green (the hooks do nothing when no recording is active).
- Commit: `phase-10: step 3d recording manager and hooks`

---

### Step 10.3.6: SFU recording endpoints

**Why**

- recording-service needs HTTP calls to start, stop, and check the capture.

**How it works**

- `POST /recordings/start`: looks up the Router (404 if the room has none), then calls `startRecording`.
- `POST /recordings/stop`: starts the stop in the background and answers at once with `{ stopping: true }`. The real result arrives through the webhook.
- `GET /recordings/:roomId/status`: used by recovery.
- `recordingId` must be a UUID, because it becomes a folder name. This also blocks path tricks.

**Code**

**File:** `services/sfu-service/src/validation/sfuSchemas.ts` (add at the bottom)

```typescript
/**
 * STEP 5: recordingId becomes a folder name, so only a UUID is accepted.
 */
export const startRecordingSchema = Joi.object({
  roomId: id,
  recordingId: Joi.string().guid().required(),
});

export const stopRecordingSchema = Joi.object({
  roomId: id,
  recordingId: Joi.string().guid().required(),
});
```

**File:** `services/sfu-service/src/controllers/recordingController.ts` (new)

```typescript
import type { Request, Response, NextFunction } from 'express';
import { getRouter } from '../mediasoup/roomManager.ts';
import { startRecording, stopRecording, getRecordingStatus } from '../recording/recordingManager.ts';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

/**
 * startRecordingHandler   -> POST /api/v1/sfu/recordings/start
 *
 * STEP 1: Joi already checked roomId and recordingId (UUID).
 * STEP 2: getRouter() throws 404 when nobody has joined the room yet.
 * STEP 3: Start the recording. A second start for the same room is 409.
 * STEP 4: Answer { started: true, segments }.
 */
export async function startRecordingHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, recordingId } = req.body;

        const router = await getRouter(roomId);                                  // STEP 2
        const { segments } = await startRecording(router, roomId, recordingId);  // STEP 3

        res.json({ success: true, data: { started: true, segments } });          // STEP 4
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
 * STEP 1: Start the stop in the background (SIGINT + manifest + webhook can take a few seconds).
 * STEP 2: Answer at once. Calling it twice, or for an unknown room, is fine (idempotent).
 */
export async function stopRecordingHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, recordingId } = req.body;

        void stopRecording(roomId, recordingId, 'stopped').catch((err) =>       // STEP 1
            logger.error({ err, roomId, recordingId }, 'stopRecording failed'),
        );

        res.json({ success: true, data: { stopping: true } });                   // STEP 2
    } catch (err) {
        next(err instanceof AppError ? err : new AppError('Failed to stop recording', 500));
    }
}

/** recordingStatusHandler   -> GET /api/v1/sfu/recordings/:roomId/status */
export function recordingStatusHandler(req: Request, res: Response, next: NextFunction) {
    try {
        res.json({ success: true, data: getRecordingStatus(String(req.params.roomId)) });
    } catch (err) {
        next(err instanceof AppError ? err : new AppError('Failed to read recording status', 500));
    }
}
```

**File:** `services/sfu-service/src/routes/sfuRoutes.ts` (add the imports, and the 3 routes before `export default router`)

```typescript
import {
  startRecordingHandler, stopRecordingHandler, recordingStatusHandler,
} from '../controllers/recordingController.ts';
import { startRecordingSchema, stopRecordingSchema } from '../validation/sfuSchemas.ts';

// STEP 9: recording (called by recording-service only, behind authGuard like every SFU route)
router.post('/recordings/start', validate(startRecordingSchema), startRecordingHandler);
router.post('/recordings/stop', validate(stopRecordingSchema), stopRecordingHandler);
router.get(
  '/recordings/:roomId/status',
  validate(roomParamsSchema, 'params'),
  recordingStatusHandler,
);
```

**Done when**

- `npx tsc --noEmit` is clean, `docker compose up -d --build sfu-service` works.
- Without the secret, `POST /api/v1/sfu/recordings/start` gives 401. With a bad body it gives 400.
- Commit: `phase-10: step 3e sfu recording endpoints`

---

## Step 10.4: Test the SFU recorder alone

**Why**

- If the SFU capture plays correctly in VLC, the rest of the phase is ordinary service work. If it does not, nothing after it will work. So test it before writing recording-service.

**How it works**

- The test page already makes Peer A produce real camera and mic through the SFU. We add **Part 4**, which starts a recording, waits 10 seconds, and stops it. Then you inspect the files by hand.
- Optional: `?room=<code>` in the page URL lets the page use a real room code as the SFU room id. You will use that in Step 10.10 for the full test.

**Code (4 edits to the page)**

**File:** `test-client/sfu-one-click.html`

**Edit 1: the button** (in the `<div class="bar">`, right after the `go` button)

```html
<button id="rec" class="ghost" disabled>1b. Test recording (Step 10)</button>
```

**Edit 2: the step list** (add 7 names at the end of `STEPS`, and a new constant next to `PART3_START`)

```javascript
  // Part 4 (Step 10 recording)
  'Start recording (200, 1 segment)',
  'Status says active',
  'Second start is rejected (409)',
  'Record for 10 seconds',
  'Stop recording (200)',
  'Second stop is idempotent (200)',
  'Status says not active',
];
const PART2_START = 10;
const PART3_START = 16;
const PART4_START = 21;
```

(The `];` closes the existing `STEPS` array, so remove the old `];` and the old `PART2_START` / `PART3_START` lines to avoid duplicates.)

**Edit 3: the separator** (replace the `pathEl.innerHTML = ...` expression so Part 4 gets its title)

```javascript
const sep = i === 0 ? '<li class="sep">Part 1 \u2013 media flow</li>'
          : i === PART2_START ? '<li class="sep">Part 2 \u2013 leave and cleanup (Step 9)</li>'
          : i === PART3_START ? '<li class="sep">Part 3 \u2013 internal auth (Step 10)</li>'
          : i === PART4_START ? '<li class="sep">Part 4 \u2013 recording (Phase 10)</li>' : '';
```

**Edit 4: the logic** (add at the bottom of the `<script>`, and two small changes in the `go` handler)

```javascript
/**
 * testRecording()
 *
 * STEP 1: Start a recording for the room from Part 1. Peer A has camera and mic,
 *         so expect 200 and exactly 1 segment.
 * STEP 2: Status must say active with our recordingId.
 * STEP 3: A second start for the same room must be rejected (409).
 * STEP 4: Record for 10 seconds (talk, wave, clap once for the lip-sync check).
 * STEP 5: Stop. Expect 200 { stopping: true }.
 * STEP 6: Stop again. Must still be 200 (idempotent).
 * STEP 7: After 3 seconds the status must say not active.
 */
async function testRecording() {
  const { roomId } = S;
  if (!roomId) throw new Error('Run Part 1 first');
  const recordingId = crypto.randomUUID();
  S.recordingId = recordingId;
  log('Recording id: ' + recordingId);

  await step(PART4_START, async () => {                                  // STEP 1
    const r = await post('/recordings/start', { roomId, recordingId });
    check(r.status === 200, 'expected 200, got ' + r.status + (r.json?.message ? ' \u2013 ' + r.json.message : ''));
    check(r.json?.data?.segments === 1, 'expected 1 segment, got ' + r.json?.data?.segments);
  });

  await step(PART4_START + 1, async () => {                              // STEP 2
    const r = await get(`/recordings/${roomId}/status`);
    check(r.json?.data?.active === true && r.json.data.recordingId === recordingId, 'status is not active');
  });

  await step(PART4_START + 2, async () => {                              // STEP 3
    const r = await post('/recordings/start', { roomId, recordingId: crypto.randomUUID() });
    check(r.status === 409, 'expected 409, got ' + r.status);
  });

  await step(PART4_START + 3, async () => {                              // STEP 4
    for (let i = 10; i > 0; i--) {
      log('  recording... ' + i + 's left');
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  await step(PART4_START + 4, async () => {                              // STEP 5
    const r = await post('/recordings/stop', { roomId, recordingId });
    check(r.status === 200 && r.json?.data?.stopping === true, 'expected 200 stopping, got ' + r.status);
  });

  await step(PART4_START + 5, async () => {                              // STEP 6
    const r = await post('/recordings/stop', { roomId, recordingId });
    check(r.status === 200, 'expected 200, got ' + r.status);
  });

  await step(PART4_START + 6, async () => {                              // STEP 7
    await new Promise((r) => setTimeout(r, 3000));
    const r = await get(`/recordings/${roomId}/status`);
    check(r.json?.data?.active === false, 'recording is still active');
  });
}

$('rec').onclick = async () => {
  $('rec').disabled = true;
  for (let i = PART4_START; i < STEPS.length; i++) mark(i, '', '');
  $('verdict').className = 'verdict'; $('verdict').textContent = '';
  try {
    await testRecording();
    $('verdict').className = 'verdict ok';
    $('verdict').textContent = 'Part 4 passed (7/7). Now inspect the files (see the log).';
    log('Files:  docker compose exec sfu-service ls -lh /recordings/' + S.recordingId + '/raw');
  } catch (e) {
    $('verdict').className = 'verdict bad';
    $('verdict').textContent = 'Recording test failed. Details are in the list and log.';
  } finally {
    $('rec').disabled = false;
  }
};
```

In the existing `go` handler make two small changes:

```javascript
// 1) at the top of the handler, where roomId is created: allow a real room code from the URL (?room=abc-defg-hij)
const roomId = new URLSearchParams(location.search).get('room') || 'oneclick-' + Math.random().toString(36).slice(2, 8);

// 2) in its "finally" block, enable the new button once Part 1 created a room
$('rec').disabled = !S.roomId;
```

**Run order:** click **1. Run full test** → click **1b. Test recording** → then click **2. Test leave + cleanup**.

**Inspect the files** (run from the project root):

```powershell
docker compose exec sfu-service ls -lh /recordings/<recordingId>/raw
docker compose exec sfu-service ffprobe -hide_banner /recordings/<recordingId>/raw/0-peer-a-camera.mkv
docker compose exec sfu-service cat /recordings/<recordingId>/manifest.json
docker cp sfu-service:/recordings/<recordingId>/raw ./out
docker compose logs sfu-service | findstr /i "ffmpeg webhook segment"
```

The webhook will fail with retries now, because recording-service does not exist yet. That is expected.

**Done when**

- Part 4 shows 7/7 green.
- The `.mkv` plays in VLC with video **and** audio. Clap once: picture and sound line up.
- `ffprobe` lists one video stream and one audio stream.
- `docker compose exec sfu-service ps aux` shows **no** leftover `ffmpeg`.
- Run Part 1b five times in a row (new page load each time): no `No free recording RTP port` (ports are freed).
- Commit: `phase-10: step 4 sfu recording test`

**If something fails**

| Symptom                                               | Likely cause                          | What to do                                                                                                                                        |
| :---------------------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| File is 0 bytes                                       | FFmpeg got no RTP                     | Check the SDP file next to the`.mkv`: the port and payload type must match. Look at `docker compose logs sfu-service` for `ffmpeg` warnings |
| `Protocol not on whitelist`                         | Missing flag                          | The args must contain`-protocol_whitelist file,udp,rtp`                                                                                         |
| `ffmpeg exited right after start` in the log        | Bad SDP or ENOENT                     | Run`ffmpeg -protocol_whitelist file,udp,rtp -i <file>.sdp -t 3 -f null -` inside the container to see the error                                 |
| `createPlainTransport` type error on `listenInfo` | Different option name in your version | Open the type in`node_modules/mediasoup` and use the option it shows                                                                            |
| Video but no audio                                    | Mic producer missing at start         | Wait for the 1.5 s debounce; check that the page produced`mic`                                                                                  |
| Black first seconds                                   | Key frame came late                   | Normal for a few hundred ms. If long, check the 10 s key frame timer logs                                                                         |
| Audio ahead of video                                  | Separate processes or missing RTCP    | Camera and mic must share one SDP. Check there is a single`.mkv` for the peer                                                                   |

---

# PART B: recording-service (Steps 10.5 to 10.7)

---

## Step 10.5: recording-service skeleton, database, start/stop API, webhook

Nine sub-steps. At the end, a host can start and stop a recording and the row reaches `PROCESSING`.

### Step 10.5.1: Create the service from room-service

**Why**

- Room Service already has your working Prisma 7 setup, import style, Docker pattern, and error handling. Starting from a copy avoids mistakes I cannot see from here.

**How it works**

- Copy `services/room-service` to `services/recording-service`, then change only what is listed below.

| Do     | Item                                                                                                                                                                  |
| :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep   | `package.json` deps and scripts, `tsconfig.json`, `prisma.config.ts`, the `db.ts` that creates the Prisma client, `Dockerfile` structure, `.dockerignore` |
| Rename | package name →`recording-service`, port → `4007`                                                                                                                |
| Delete | room controllers, routes, validation,`nanoid` usage, the old `prisma/migrations`, the models in `schema.prisma`                                                 |
| Add    | `npm install bullmq`                                                                                                                                                |

```powershell
cd services/recording-service
npm install bullmq
```

**Target structure**

```
services/recording-service/
├── server.ts
├── package.json, tsconfig.json, prisma.config.ts, Dockerfile, .env, .env.docker
├── prisma/schema.prisma
└── src/
    ├── app.ts
    ├── config/        env.ts, db.ts, redis.ts, roomServiceClient.ts, sfuClient.ts
    ├── controllers/   recordingController.ts, internalController.ts
    ├── routes/        recordingRoutes.ts, internalRoutes.ts
    ├── middleware/    authGuard.ts, internalGuard.ts, errorHandler.ts, validate.ts
    ├── validation/    recordingSchemas.ts
    ├── services/      recordingService.ts
    ├── queue/         queues.ts, finalizeWorker.ts          (worker in 10.6)
    ├── processing/    ffmpeg.ts, finalizeRecording.ts       (10.6)
    ├── storage/       index.ts, localStorage.ts             (10.7)
    ├── events/        publisher.ts
    ├── types/         status.ts
    └── utils/         AppError.ts, logger.ts, dto.ts
```

**Done when:** the copied service starts with `npm run dev` and `/health` answers `{ status: 'ok', service: 'recording-service' }`.

---

### Step 10.5.2: Env, utilities, status type

**Why**

- Secrets and settings must fail at startup when missing, so a mistake shows on boot and not on the first request.

**How it works**

- Same rule as the SFU: `INTERNAL_SECRET` must be at least 16 characters and identical in all services.
- `AppError`, `logger`, and `errorHandler` are copied from the SFU (the error shape is `{ success: false, message }`).

**Code**

**File:** `services/recording-service/src/config/env.ts`

```typescript
import 'dotenv/config';

/**
 * env.ts
 *
 * STEP 1: required(name) throws at startup when a variable is missing.
 * STEP 2: INTERNAL_SECRET must be at least 16 characters and the SAME value
 *         the SFU uses, or webhook and SFU calls get 401.
 * STEP 3: Everything else has a safe default for local development.
 */
function required(name: string): string {                                       // STEP 1
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const internalSecret = process.env.INTERNAL_SECRET ?? '';                       // STEP 2
if (internalSecret.length < 16) {
  throw new Error('INTERNAL_SECRET is missing or shorter than 16 characters');
}

export const env = {                                                            // STEP 3
  port: Number(process.env.PORT) || 4007,
  nodeEnv: process.env.NODE_ENV || 'development',
  redisUrl: required('REDIS_URL'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  roomServiceUrl: required('ROOM_SERVICE_URL'),
  sfuServiceUrl: process.env.SFU_SERVICE_URL || 'http://localhost:4006',
  internalSecret,
  recordingDir: process.env.RECORDING_DIR || '/recordings',
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  finalizeConcurrency: Number(process.env.FINALIZE_CONCURRENCY) || 1,
  maxRecordingMinutes: Number(process.env.MAX_RECORDING_MINUTES) || 240,
  rawRetentionHours: Number(process.env.RAW_RETENTION_HOURS) || 24,
  minFreeDiskMb: Number(process.env.MIN_FREE_DISK_MB) || 2048,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
};
```

(`DATABASE_URL` is read by your Prisma config, as in room-service, so it is not repeated here.)

**File:** `services/recording-service/.env` (local) and `.env.docker`

```dotenv
PORT=4007
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/recording_db
REDIS_URL=redis://redis:6379
JWT_ACCESS_SECRET=<same value as the other services>
ROOM_SERVICE_URL=http://room-service:4003
SFU_SERVICE_URL=http://sfu-service:4006
INTERNAL_SECRET=<same value as the SFU>
RECORDING_DIR=/recordings
STORAGE_DRIVER=local
FINALIZE_CONCURRENCY=1
MAX_RECORDING_MINUTES=240
RAW_RETENTION_HOURS=24
MIN_FREE_DISK_MB=2048
```

For the `.env` used outside Docker, change the hosts to `localhost` (as in your other services).

**File:** `services/recording-service/src/types/status.ts`

```typescript
/**
 * Statuses are stored as plain strings in Postgres.
 * This type keeps the code honest without depending on generated Prisma enums.
 *
 *   STARTING -> RECORDING -> STOPPING -> PROCESSING -> READY
 *                   \____________\____________\_____-> FAILED
 */
export type RecordingStatus =
  | 'STARTING' | 'RECORDING' | 'STOPPING' | 'PROCESSING' | 'READY' | 'FAILED';

export type SegmentStatus = 'PENDING' | 'READY' | 'FAILED';

export const ACTIVE_STATUSES: RecordingStatus[] = ['STARTING', 'RECORDING', 'STOPPING', 'PROCESSING'];
```

**File:** `services/recording-service/src/utils/dto.ts`

```typescript
/**
 * toSegmentDto(recordingId, segment)
 *
 * STEP 1: sizeBytes is a BigInt in the database, and JSON cannot hold a BigInt.
 *         Convert it to a number (safe up to 9 petabytes).
 * STEP 2: Never show the server path (rawPath) or the storage key to clients.
 * STEP 3: Add the download URL, so the frontend does not build it by hand.
 */
export function toSegmentDto(recordingId: string, s: any) {
  const { rawPath, storageKey, sizeBytes, ...rest } = s;                       // STEP 2
  return {
    ...rest,
    sizeBytes: sizeBytes == null ? null : Number(sizeBytes),                   // STEP 1
    downloadUrl: s.status === 'READY' ? `/v1/recordings/${recordingId}/segments/${s.id}/download` : null,   // STEP 3
  };
}
```

**Also copy from the SFU** (same code, only change imports to `.js`):
`utils/AppError.ts`, `utils/logger.ts` (use the signaling version with `pino`), `middleware/errorHandler.ts`, `middleware/validate.ts`.

**Done when:** `npx tsc --noEmit` is clean and the service starts with the env file.

---

### Step 10.5.3: Database models

**Why**

- Two tables: `Recording` (one per recording) and `RecordingSegment` (one per captured file).

**How it works**

- Keep the `generator` and `datasource` blocks **exactly as in room-service**. Replace only the models.
- Statuses are `String` with a default.
- `startOffsetMs` is the segment start relative to the recording start. It is what a future combined video will use.

**Code**

**File:** `services/recording-service/prisma/schema.prisma` (models only)

```prisma
model Recording {
  id         String   @id @default(uuid())
  roomCode   String
  startedBy  String                        // userId of the host
  status     String   @default("STARTING") // see src/types/status.ts
  startedAt  DateTime @default(now())
  stoppedAt  DateTime?
  durationMs Int?
  error      String?
  segments   RecordingSegment[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([roomCode])
  @@index([startedBy])
  @@index([status])
}

model RecordingSegment {
  id            String    @id @default(uuid())
  recordingId   String
  recording     Recording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  index         Int
  peerId        String                      // socket id at capture time
  userId        String?                     // from the SFU producer appData
  source        String                      // 'camera' | 'screen'
  hasVideo      Boolean
  hasAudio      Boolean
  startOffsetMs Int                         // relative to the recording start
  durationMs    Int?
  rawPath       String                      // /recordings/<id>/raw/...mkv
  storageKey    String?                     // final mp4 key, e.g. <id>/final/0-camera-xxxx.mp4
  sizeBytes     BigInt?
  status        String    @default("PENDING")
  error         String?

  @@index([recordingId])
}
```

```powershell
npx prisma migrate dev --name init
```

**Done when:** the migration runs and the two tables exist in `recording_db`:

```powershell
docker compose exec postgres psql -U postgres -d recording_db -c "\dt"
```

---

### Step 10.5.4: Clients (Redis, Room Service, SFU, events)

**Why**

- The service talks to four things: Redis (lock + events), Room Service (host check), the SFU (start/stop capture), and Redis again (publish events).

**How it works**

- `roomServiceClient` is the same call signaling already makes, with clearer errors.
- `sfuClient` follows the signaling `sfuClient`: secret header, timeout, SFU errors keep their status. `startCapture` gets a longer timeout, because the SFU waits about 800 ms per segment.
- `publishRecordingEvent` **never throws**. A failed publish must not break a recording.

**Code**

**File:** `services/recording-service/src/config/redis.ts`

```typescript
import Redis from 'ioredis';
import { env } from './env.js';
import logger from '../utils/logger.js';

const redis = new Redis(env.redisUrl);
redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

/** One recording per room. Signaling reads the same key to tell late joiners "recording is on". */
export const lockKey = (roomCode: string) => `recording:active:${roomCode}`;

export default redis;
```

**File:** `services/recording-service/src/config/roomServiceClient.ts`

```typescript
import axios from 'axios';
import { env } from './env.js';
import AppError from '../utils/AppError.js';

export interface RoomInfo {
  hostUserId: string;
  [key: string]: unknown;
}

/**
 * getActiveRoom(code, token)
 *
 * STEP 1: Ask Room Service for the room, with the caller's own token.
 * STEP 2: 404 -> "Room not found or has ended". 401/403 -> not allowed.
 *         Anything else (timeout, 5xx) -> 502, the problem is on our side.
 * STEP 3: Return data.room (same shape signaling uses).
 */
export async function getActiveRoom(code: string, token: string): Promise<RoomInfo> {
  try {
    const resp = await axios.get(`${env.roomServiceUrl}/v1/rooms/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    return resp.data.data.room as RoomInfo;                                     // STEP 3
  } catch (err: any) {
    const status = err?.response?.status;                                       // STEP 2
    if (status === 404 || status === 410) throw new AppError('Room not found or has ended', 404);
    if (status === 401 || status === 403) throw new AppError('Not allowed to read this room', 403);
    throw new AppError('Room service unavailable', 502);
  }
}
```

**File:** `services/recording-service/src/config/sfuClient.ts`

```typescript
import { env } from './env.js';
import AppError from '../utils/AppError.js';

/**
 * sfuClient.ts
 *
 * STEP 1: request() is the only place that calls the SFU. It adds x-internal-secret and a timeout.
 * STEP 2: A network error or timeout -> AppError 503 "SFU service unreachable".
 * STEP 3: A non-2xx answer -> AppError with the SFU's own status and message.
 * STEP 4: On success return json.data.
 */
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 5000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.sfuServiceUrl}/api/v1/sfu${path}`, {                // STEP 1
      method,
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': env.internalSecret },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('SFU service unreachable', 503);                          // STEP 2
  }

  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }

  if (!res.ok || !json?.success) {                                               // STEP 3
    throw new AppError(json?.message ?? `SFU error ${res.status}`, res.status || 502);
  }
  return json.data as T;                                                         // STEP 4
}

const enc = encodeURIComponent;

// startCapture waits for FFmpeg (about 800 ms per segment, in parallel), so it gets 15 s
export const startCapture = (roomId: string, recordingId: string) =>
  request<{ started: boolean; segments: number }>('POST', '/recordings/start', { roomId, recordingId }, 15000);

export const stopCapture = (roomId: string, recordingId: string) =>
  request<{ stopping: boolean }>('POST', '/recordings/stop', { roomId, recordingId });

export const captureStatus = (roomId: string) =>
  request<{ active: boolean; recordingId?: string; segments: number }>('GET', `/recordings/${enc(roomId)}/status`);
```

**File:** `services/recording-service/src/events/publisher.ts`

```typescript
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

export type RecordingEventType =
  | 'recording-started' | 'recording-stopped' | 'recording-ready' | 'recording-failed';

/**
 * publishRecordingEvent(type, data)
 *
 * STEP 1: Publish { type, ...data } on the "recording-events" channel.
 *         Signaling subscribes and emits it to everyone in the room.
 * STEP 2: NEVER throw. A failed notification must not break a recording.
 */
export async function publishRecordingEvent(
  type: RecordingEventType,
  data: { roomCode: string; recordingId: string; startedBy?: string },
): Promise<void> {
  try {
    await redis.publish('recording-events', JSON.stringify({ type, ...data }));      // STEP 1
  } catch (err) {
    logger.error({ err, type }, 'Could not publish recording event');                // STEP 2
  }
}
```

**Done when:** `npx tsc --noEmit` is clean.

---

### Step 10.5.5: Middleware (user JWT and internal secret)

**Why**

- Two kinds of callers: **users** (JWT, through the gateway) and the **SFU** (shared secret, over the Docker network). They must never be mixed.

**How it works**

- `authGuard` verifies the same JWT as signaling and puts `userId` and the raw token in `res.locals`.
- `internalGuard` is the SFU's `authGuard`: SHA-256 both sides, then `timingSafeEqual`. Same error for a missing and a wrong secret.

**Code**

**File:** `services/recording-service/src/middleware/authGuard.ts`

```typescript
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import AppError from '../utils/AppError.js';

/**
 * authGuard(req, res, next)
 *
 * STEP 1: Read "Authorization: Bearer <token>". Missing -> 401.
 * STEP 2: Verify with JWT_ACCESS_SECRET (the same secret signaling uses).
 *         Bad or expired -> 401.
 * STEP 3: Store userId and the token in res.locals for the controllers.
 *         The token is needed to ask Room Service on the user's behalf.
 */
export function authGuard(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;      // STEP 1
  if (!token) return next(new AppError('No token provided', 401));

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as { userId?: string };   // STEP 2
    if (!payload.userId) throw new Error('no userId in token');

    res.locals.userId = payload.userId;                                               // STEP 3
    res.locals.token = token;
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}
```

**File:** `services/recording-service/src/middleware/internalGuard.ts`

```typescript
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.js';
import { env } from '../config/env.js';

/**
 * internalGuard(req, res, next)
 *
 * STEP 1: Hash the expected secret once at startup (SHA-256), so both sides have
 *         the same length (timingSafeEqual needs that) and no length is leaked.
 * STEP 2: Read x-internal-secret. Missing -> 401.
 * STEP 3: Hash the received value and compare with timingSafeEqual.
 * STEP 4: Same 401 message for missing and wrong.
 */
const expectedHash = crypto.createHash('sha256').update(env.internalSecret).digest();   // STEP 1

export function internalGuard(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('x-internal-secret');                                       // STEP 2
  if (typeof header !== 'string' || header.length === 0) {
    return next(new AppError('Unauthorized', 401));
  }

  const receivedHash = crypto.createHash('sha256').update(header).digest();             // STEP 3
  if (!crypto.timingSafeEqual(receivedHash, expectedHash)) {
    return next(new AppError('Unauthorized', 401));                                     // STEP 4
  }
  next();
}
```

**Done when:** `npx tsc --noEmit` is clean.

---

### Step 10.5.6: Validation schemas

**Why**

- Bad input must stop with a clean 400 before any controller runs (same pattern as the SFU).

**Code**

**File:** `services/recording-service/src/validation/recordingSchemas.ts`

```typescript
import Joi from 'joi';

/**
 * recordingSchemas.ts
 *
 * STEP 1: Ids in the URL are UUIDs. Anything else is a 400, which also blocks path tricks.
 * STEP 2: roomCode is a short trimmed string (your codes look like "7oz-5wjh-gpu").
 * STEP 3: captureEndedSchema checks the webhook body from the SFU.
 *         .unknown(true) lets the extra manifest fields (recordingId, roomId) through.
 */
const uuid = Joi.string().guid().required();                                                  // STEP 1

export const startSchema = Joi.object({
  roomCode: Joi.string().trim().min(1).max(64).required(),                                    // STEP 2
});

export const listQuerySchema = Joi.object({
  roomCode: Joi.string().trim().max(64).optional(),
});

export const idParamsSchema = Joi.object({ id: uuid });
export const segmentParamsSchema = Joi.object({ id: uuid, segmentId: uuid });

export const captureEndedSchema = Joi.object({                                                // STEP 3
  recordingStartedAtMs: Joi.number().required(),
  recordingEndedAtMs: Joi.number().required(),
  reason: Joi.string().optional(),
  segments: Joi.array().items(
    Joi.object({
      index: Joi.number().integer().min(0).required(),
      peerId: Joi.string().max(128).required(),
      userId: Joi.string().max(128).allow('', null).optional(),
      source: Joi.string().valid('camera', 'screen').required(),
      hasVideo: Joi.boolean().required(),
      hasAudio: Joi.boolean().required(),
      file: Joi.string().required(),
      startedAtMs: Joi.number().required(),
      endedAtMs: Joi.number().required(),
    }),
  ).required(),
}).unknown(true);
```

---

### Step 10.5.7: Queue definition and domain logic

**Why**

- The rules (who stops, how a webhook becomes rows, how a failure is recorded) must live in **one** place, because three callers use them: the HTTP controllers, the auto-stop job, and the recovery sweep.

**How it works**

- `queues.ts` only defines the queue and `enqueueFinalize`. The worker comes in Step 10.6.
- The job id `finalize-<recordingId>` makes a duplicate webhook harmless (BullMQ ignores a second job with the same id).
- `requestStop` and `ingestCapture` use **atomic status changes** (`updateMany ... where status = X`). If two requests race, only one wins and the other sees `count = 0`.
- `ingestCapture` checks that every file path is inside `/recordings/<id>/`, even though the SFU is trusted.

**Code**

**File:** `services/recording-service/src/queue/queues.ts`

```typescript
import { Queue } from 'bullmq';
import { env } from '../config/env.js';

/**
 * queues.ts
 *
 * STEP 1: BullMQ gets plain connection OPTIONS built from REDIS_URL.
 *         It then creates its own connections with the right settings
 *         (workers need maxRetriesPerRequest: null). Passing your own
 *         ioredis instance can clash with BullMQ's bundled ioredis version.
 *
 * STEP 2: attempts 3 with exponential backoff, so a temporary FFmpeg or disk
 *         error is retried before the job counts as failed.
 *
 * STEP 3: enqueueFinalize() uses a fixed job id, so a duplicate webhook
 *         cannot queue the same recording twice.
 */
export function redisConnection() {                                              // STEP 1
  const u = new URL(env.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    username: u.username || undefined,
    password: u.password || undefined,
  };
}

export const finalizeQueue = new Queue('recording-finalize', {
  connection: redisConnection(),
  defaultJobOptions: {                                                           // STEP 2
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export function enqueueFinalize(recordingId: string) {                           // STEP 3
  return finalizeQueue.add('finalize', { recordingId }, { jobId: `finalize-${recordingId}` });
}
```

**File:** `services/recording-service/src/services/recordingService.ts`

```typescript
import path from 'node:path';
import { prisma } from '../config/db.js';            // ADAPT: use the same import as room-service
import redis, { lockKey } from '../config/redis.js';
import { env } from '../config/env.js';
import * as sfu from '../config/sfuClient.js';
import { publishRecordingEvent } from '../events/publisher.js';
import { enqueueFinalize } from '../queue/queues.js';
import logger from '../utils/logger.js';

/**
 * recordingService.ts: the rules shared by controllers, auto-stop and recovery.
 */

/**
 * requestStop(recordingId, roomCode)
 *
 * STEP 1: Atomically change RECORDING -> STOPPING. If the row was not RECORDING
 *         (already stopping, or finished), count is 0 and we do nothing.
 * STEP 2: Tell the SFU. It answers at once; the real result is the webhook.
 *         If the SFU is down, the status stays STOPPING and recovery fixes it later.
 * Returns true when this call really started the stop.
 */
export async function requestStop(recordingId: string, roomCode: string): Promise<boolean> {
  const { count } = await prisma.recording.updateMany({                          // STEP 1
    where: { id: recordingId, status: 'RECORDING' },
    data: { status: 'STOPPING' },
  });
  if (count === 0) return false;

  try {
    await sfu.stopCapture(roomCode, recordingId);                                // STEP 2
  } catch (err) {
    logger.error({ err, recordingId, roomCode }, 'SFU stop failed, recovery will handle it');
  }
  return true;
}

/**
 * markFailed(recordingId, reason)
 *
 * STEP 1: Set FAILED with the reason, unless it is already READY.
 * STEP 2: Release the room lock and tell the room.
 */
export async function markFailed(recordingId: string, reason: string): Promise<void> {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec || rec.status === 'READY') return;

  await prisma.recording.update({                                                // STEP 1
    where: { id: recordingId },
    data: { status: 'FAILED', error: reason.slice(0, 500) },
  });

  if ((await redis.get(lockKey(rec.roomCode))) === recordingId) {                // STEP 2
    await redis.del(lockKey(rec.roomCode));
  }
  await publishRecordingEvent('recording-failed', { roomCode: rec.roomCode, recordingId });
}

export interface CaptureBody {
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
  reason?: string;
  segments: {
    index: number; peerId: string; userId?: string | null; source: string;
    hasVideo: boolean; hasAudio: boolean; file: string; startedAtMs: number; endedAtMs: number;
  }[];
}

/**
 * ingestCapture(recordingId, body)   used by the webhook AND by recovery
 *
 * STEP 1: Atomically claim the recording: RECORDING or STOPPING -> PROCESSING.
 *         A duplicate webhook finds count = 0 and returns "duplicate".
 * STEP 2: Release the room lock and publish recording-stopped.
 * STEP 3: Keep only files inside /recordings/<id>/ (defence in depth).
 *         No files -> FAILED "No media captured".
 * STEP 4: Insert the segments (startOffsetMs = segment start - recording start),
 *         then queue the finalize job.
 * STEP 5: If inserting or queueing fails, mark the recording FAILED and rethrow.
 */
export async function ingestCapture(
  recordingId: string, body: CaptureBody,
): Promise<'ingested' | 'duplicate' | 'not-found'> {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec) return 'not-found';

  const claim = await prisma.recording.updateMany({                              // STEP 1
    where: { id: recordingId, status: { in: ['RECORDING', 'STOPPING'] } },
    data: {
      status: 'PROCESSING',
      stoppedAt: new Date(body.recordingEndedAtMs),
      durationMs: Math.max(0, Math.round(body.recordingEndedAtMs - body.recordingStartedAtMs)),
    },
  });
  if (claim.count === 0) return 'duplicate';

  if ((await redis.get(lockKey(rec.roomCode))) === recordingId) {                // STEP 2
    await redis.del(lockKey(rec.roomCode));
  }
  await publishRecordingEvent('recording-stopped', { roomCode: rec.roomCode, recordingId });

  const base = path.resolve(env.recordingDir, recordingId) + path.sep;           // STEP 3
  const safe = body.segments.filter((s) => path.resolve(s.file).startsWith(base));
  if (safe.length === 0) {
    await markFailed(recordingId, 'No media captured');
    return 'ingested';
  }

  try {
    await prisma.recordingSegment.createMany({                                   // STEP 4
      data: safe.map((s) => ({
        recordingId,
        index: s.index,
        peerId: s.peerId,
        userId: s.userId ?? null,
        source: s.source,
        hasVideo: s.hasVideo,
        hasAudio: s.hasAudio,
        startOffsetMs: Math.max(0, Math.round(s.startedAtMs - body.recordingStartedAtMs)),
        durationMs: Math.max(0, Math.round(s.endedAtMs - s.startedAtMs)),
        rawPath: s.file,
      })),
    });
    await enqueueFinalize(recordingId);
  } catch (err) {
    await markFailed(recordingId, 'Could not queue processing');                 // STEP 5
    throw err;
  }
  return 'ingested';
}
```

**Done when:** `npx tsc --noEmit` is clean.

---

### Step 10.5.8: Controllers

**Why**

- Thin HTTP handlers that read the request, call the rules above, and shape the response.

**How it works**

- **Start:** JWT → Room Service host check → take the Redis lock → create the row → call the SFU → mark `RECORDING` → publish → `201`.
  If anything fails after the lock is taken, the lock is released and the row is marked `FAILED`.
- **Stop:** only the user who started it, and only while `RECORDING`.
- **Webhook:** answers `200` for a duplicate (the SFU must not retry forever).
- **Download, list, get, delete:** only the user who started the recording (MVP rule).
- Download and delete use the storage driver from Step 10.7. Until then they are added as stubs.

**Code**

**File:** `services/recording-service/src/controllers/recordingController.ts`

```typescript
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';             // ADAPT: same import as room-service
import redis, { lockKey } from '../config/redis.js';
import { env } from '../config/env.js';
import { getActiveRoom } from '../config/roomServiceClient.js';
import * as sfu from '../config/sfuClient.js';
import { publishRecordingEvent } from '../events/publisher.js';
import { requestStop, markFailed } from '../services/recordingService.js';
import { toSegmentDto } from '../utils/dto.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

const LOCK_TTL_SECONDS = env.maxRecordingMinutes * 60 + 600;

/** Load a recording and make sure the caller is the one who started it (404 / 403). */
async function loadOwned(id: string, userId: string) {
  const rec = await prisma.recording.findUnique({ where: { id }, include: { segments: { orderBy: { index: 'asc' } } } });
  if (!rec) throw new AppError('Recording not found', 404);
  if (rec.startedBy !== userId) throw new AppError('You are not allowed to access this recording', 403);
  return rec;
}

/**
 * startRecordingHandler   -> POST /v1/recordings/start   { roomCode }
 *
 * STEP 1: userId and token come from authGuard (verified JWT).
 * STEP 2: Ask Room Service for the room. Not found or ended -> 404.
 * STEP 3: Host check: room.hostUserId must equal the caller, else 403.
 * STEP 4: Take the lock "recording:active:<roomCode>" with SET NX.
 *         The recording id is generated first so the lock can hold it.
 *         Not acquired -> 409 "already being recorded".
 * STEP 5: Insert the row (STARTING), then ask the SFU to start capturing.
 *         SFU 404 means nobody is in the call yet -> 409 "Nobody is in the call".
 * STEP 6: On ANY failure after the lock: delete the lock, mark FAILED, rethrow.
 * STEP 7: Mark RECORDING and tell the room (recording-started).
 * STEP 8: Answer 201 { recordingId, status }.
 */
export async function startRecordingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = res.locals.userId as string;                                    // STEP 1
    const token = res.locals.token as string;
    const { roomCode } = req.body;

    const room = await getActiveRoom(roomCode, token);                             // STEP 2
    if (room.hostUserId !== userId) throw new AppError('Only the host can record', 403);   // STEP 3

    const recordingId = randomUUID();                                              // STEP 4
    const locked = await redis.set(lockKey(roomCode), recordingId, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (locked !== 'OK') throw new AppError('This room is already being recorded', 409);

    try {
      await prisma.recording.create({                                              // STEP 5
        data: { id: recordingId, roomCode, startedBy: userId, status: 'STARTING' },
      });

      try {
        await sfu.startCapture(roomCode, recordingId);
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 404) {
          throw new AppError('Nobody is in the call yet', 409);
        }
        throw err;
      }

      await prisma.recording.update({ where: { id: recordingId }, data: { status: 'RECORDING' } });   // STEP 7
    } catch (err) {
      await redis.del(lockKey(roomCode));                                          // STEP 6
      await markFailed(recordingId, err instanceof Error ? err.message : 'start failed');
      throw err;
    }

    await publishRecordingEvent('recording-started', { roomCode, recordingId, startedBy: userId });
    // Step 10.11 adds here: scheduleAutoStop(recordingId, roomCode)

    res.status(201).json({ success: true, data: { recordingId, status: 'RECORDING' } });   // STEP 8
  } catch (err) {
    if (!(err instanceof AppError)) logger.error({ err }, 'Failed to start recording');
    next(err instanceof AppError ? err : new AppError('Failed to start recording', 500));
  }
}

/**
 * stopRecordingHandler   -> POST /v1/recordings/:id/stop
 *
 * STEP 1: Load the recording, caller must be the one who started it.
 * STEP 2: Only a RECORDING can be stopped (409 otherwise).
 * STEP 3: requestStop() does the atomic RECORDING -> STOPPING change and calls the SFU.
 *         Losing a race against another stop also gives 409.
 * STEP 4: Answer 202. The recording is not finished yet: the webhook comes next.
 */
export async function stopRecordingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rec = await loadOwned(String(req.params.id), res.locals.userId);        // STEP 1
    if (rec.status !== 'RECORDING') throw new AppError('Recording is not running', 409);   // STEP 2

    const started = await requestStop(rec.id, rec.roomCode);                       // STEP 3
    if (!started) throw new AppError('Recording is not running', 409);
    // Step 10.11 adds here: cancelAutoStop(rec.id)

    res.status(202).json({ success: true, data: { status: 'STOPPING' } });         // STEP 4
  } catch (err) {
    if (!(err instanceof AppError)) logger.error({ err }, 'Failed to stop recording');
    next(err instanceof AppError ? err : new AppError('Failed to stop recording', 500));
  }
}

/** listRecordingsHandler   -> GET /v1/recordings?roomCode=   (only the caller's recordings, newest first, max 50) */
export async function listRecordingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const roomCode = typeof req.query.roomCode === 'string' ? req.query.roomCode : undefined;
    const list = await prisma.recording.findMany({
      where: { startedBy: res.locals.userId, ...(roomCode ? { roomCode } : {}) },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: list });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError('Failed to list recordings', 500));
  }
}

/** getRecordingHandler   -> GET /v1/recordings/:id   (recording + segments with download URLs) */
export async function getRecordingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { segments, ...recording } = await loadOwned(String(req.params.id), res.locals.userId);
    res.json({
      success: true,
      data: { recording, segments: segments.map((s) => toSegmentDto(recording.id, s)) },
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError('Failed to read recording', 500));
  }
}
```

**File:** `services/recording-service/src/controllers/internalController.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ingestCapture } from '../services/recordingService.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/**
 * captureEndedHandler   -> POST /internal/recordings/:id/capture-ended   (SFU only)
 *
 * STEP 1: internalGuard already checked x-internal-secret, Joi checked the body.
 * STEP 2: ingestCapture() claims the recording, inserts the segments, queues the job.
 * STEP 3: Unknown id -> 404. A DUPLICATE webhook answers 200, so the SFU stops retrying.
 */
export async function captureEndedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await ingestCapture(String(req.params.id), req.body);          // STEP 2

    if (result === 'not-found') throw new AppError('Recording not found', 404);    // STEP 3
    res.json({ success: true, data: { result } });
  } catch (err) {
    if (!(err instanceof AppError)) logger.error({ err }, 'capture-ended failed');
    next(err instanceof AppError ? err : new AppError('Failed to handle capture-ended', 500));
  }
}
```

**Done when:** `npx tsc --noEmit` is clean.

---

### Step 10.5.9: Routes, app, server

**Why**

- Wire it together. Public routes need the user JWT, internal routes need the secret, and `/health` stays open for Docker.

**How it works**

- `/internal/*` is mounted on the service itself but **never** proxied by the gateway (Step 10.8).
- `server.ts` is where the worker and the sweepers start (added in 10.6 and 10.11).

**Code**

**File:** `services/recording-service/src/routes/recordingRoutes.ts`

```typescript
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  startSchema, listQuerySchema, idParamsSchema, segmentParamsSchema,
} from '../validation/recordingSchemas.js';
import {
  startRecordingHandler, stopRecordingHandler, listRecordingsHandler, getRecordingHandler,
} from '../controllers/recordingController.js';

/**
 * Mounted at /v1/recordings behind authGuard. Every route has a validate(...) step first.
 * Download and delete are added in Step 10.7.
 */
const router = Router();

router.post('/start', validate(startSchema), startRecordingHandler);
router.get('/', validate(listQuerySchema, 'query'), listRecordingsHandler);
router.get('/:id', validate(idParamsSchema, 'params'), getRecordingHandler);
router.post('/:id/stop', validate(idParamsSchema, 'params'), stopRecordingHandler);

export default router;
```

**File:** `services/recording-service/src/routes/internalRoutes.ts`

```typescript
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { idParamsSchema, captureEndedSchema } from '../validation/recordingSchemas.js';
import { captureEndedHandler } from '../controllers/internalController.js';

/** Mounted at /internal/recordings behind internalGuard. Called by the SFU only. */
const router = Router();

router.post(
  '/:id/capture-ended',
  validate(idParamsSchema, 'params'),
  validate(captureEndedSchema),
  captureEndedHandler,
);

export default router;
```

**File:** `services/recording-service/src/app.ts`

```typescript
import express from 'express';
import helmet from 'helmet';
import recordingRoutes from './routes/recordingRoutes.js';
import internalRoutes from './routes/internalRoutes.js';
import { authGuard } from './middleware/authGuard.js';
import { internalGuard } from './middleware/internalGuard.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * app.ts
 *
 * STEP 1: Parse JSON (the webhook body can have many segments, so allow 1 MB).
 * STEP 2: /health stays open for the Docker healthcheck.
 * STEP 3: Public API behind the user JWT.
 * STEP 4: Internal API behind the shared secret. Never proxied by the gateway.
 * STEP 5: errorHandler LAST.
 */
const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));                                                 // STEP 1

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'recording-service' }));   // STEP 2

app.use('/v1/recordings', authGuard, recordingRoutes);                                    // STEP 3
app.use('/internal/recordings', internalGuard, internalRoutes);                           // STEP 4

app.use(errorHandler);                                                                    // STEP 5

export default app;
```

**File:** `services/recording-service/server.ts`

```typescript
import app from './src/app.js';
import { env } from './src/config/env.js';
import logger from './src/utils/logger.js';

/**
 * server.ts
 *
 * STEP 1: Start the HTTP server.
 * Step 10.6 adds: start the finalize worker.
 * Step 10.11 adds: start the control worker, the recovery sweep and the cleanup timer.
 */
app.listen(env.port, () => {
  logger.info(`recording-service running on port ${env.port}`);
});
```

**Test this step** (service running, SFU running, a room with media, `<token>` = the host's access token):

```powershell
# 401 without a token
Invoke-RestMethod -Method Post -Uri http://localhost:4007/v1/recordings/start -ContentType "application/json" -Body '{"roomCode":"abc"}'

# start as the host (use ?room=<code> in the test page so the SFU room id equals the real room code)
$h = @{ Authorization = "Bearer <token>" }
Invoke-RestMethod -Method Post -Uri http://localhost:4007/v1/recordings/start -Headers $h -ContentType "application/json" -Body '{"roomCode":"<code>"}'

# stop
Invoke-RestMethod -Method Post -Uri http://localhost:4007/v1/recordings/<recordingId>/stop -Headers $h
```

**Done when**

- No token → 401. Not the host → 403. Unknown room → 404. Second start → 409. Empty room → 409.
- After a stop, the row goes `RECORDING → STOPPING → PROCESSING`, and segment rows exist.
- A job is waiting in Redis: `docker compose exec redis redis-cli keys "bull:recording-finalize:*"`.
- The lock is gone: `docker compose exec redis redis-cli keys "recording:active:*"` is empty.
- Commit: `phase-10: step 5 recording service skeleton and api`

---

## Step 10.6: BullMQ finalize worker (MKV to MP4)

**Why**

- Raw `.mkv` files hold VP8 or H264 with Opus. They are not friendly to browsers or most players. Users want **MP4 (H.264 + AAC)** that plays anywhere and seeks well.
- Converting is **CPU heavy**, so it must **not** run inside the SFU or an HTTP request. A queue gives retries and keeps the heavy work in a process you can scale separately later.

**How it works**

- When the webhook queues `finalize-<id>`, the worker loads the segments and converts each one separately.
- One broken segment is marked `FAILED` and does not stop the others.
- If **no** segment could be converted, the job throws, so BullMQ retries (3 attempts). After the last attempt the recording is marked `FAILED`.
- Retries skip segments that are already `READY`.
- Raw files stay after success. A cleanup timer removes them later (Step 10.11), so a failed run can be retried from the same raw files.
- FFmpeg settings:

| Option                                    | Why                                                                  |
| :---------------------------------------- | :------------------------------------------------------------------- |
| `-c:v libx264 -preset veryfast -crf 23` | Good quality, fast encode                                            |
| `-pix_fmt yuv420p`                      | Plays everywhere                                                     |
| `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2` | libx264 needs even width and height, and screen shares are often odd |
| `-c:a aac -b:a 128k`                    | MP4-friendly audio                                                   |
| `-movflags +faststart`                  | The browser can start playing before the full download               |

**Code**

**File:** `services/recording-service/src/processing/ffmpeg.ts`

```typescript
import { spawn } from 'node:child_process';
import { env } from '../config/env.js';

/**
 * run(bin, args)
 *
 * STEP 1: Start the program and collect its output (stderr is capped, FFmpeg is chatty).
 * STEP 2: Resolve on exit code 0. Otherwise reject with the last 500 characters of stderr,
 *         so the error stored in the database tells you what went wrong.
 */
export function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });          // STEP 1
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20_000); });
    proc.on('error', reject);

    proc.on('close', (code) => {                                                   // STEP 2
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Real duration of a media file in milliseconds, or null when ffprobe cannot tell. */
export async function probeDurationMs(file: string): Promise<number | null> {
  const { stdout } = await run(env.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ]);
  const seconds = parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/** Arguments that turn one raw MKV segment into a web-friendly MP4 (see the table in Step 10.6). */
export function buildMp4Args(input: string, output: string, hasVideo: boolean, hasAudio: boolean): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-i', input];
  if (hasVideo) {
    args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
  }
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
  args.push('-movflags', '+faststart', output);
  return args;
}
```

**File:** `services/recording-service/src/processing/finalizeRecording.ts`

```typescript
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../config/db.js';             // ADAPT: same import as room-service
import redis, { lockKey } from '../config/redis.js';
import { env } from '../config/env.js';
import { publishRecordingEvent } from '../events/publisher.js';
import { storage } from '../storage/index.js';
import { run, probeDurationMs, buildMp4Args } from './ffmpeg.js';
import logger from '../utils/logger.js';

/**
 * finalizeRecording(recordingId)
 *
 * STEP 1: Load the recording with its segments. Already READY -> return (a retry after success).
 * STEP 2: Make /recordings/<id>/final.
 * STEP 3: For each segment that is not READY yet:
 *         a) the raw file must exist and not be empty
 *         b) convert it to MP4 with ffmpeg
 *         c) hand the file to the storage driver
 *         d) read the real duration with ffprobe (fall back to the wall-clock value)
 *         e) save status READY, storageKey, size and duration
 *         A failure marks only THIS segment FAILED and goes on with the next one.
 * STEP 4: No segment ready -> throw. BullMQ retries; after the last attempt the worker marks FAILED.
 * STEP 5: At least one ready -> recording READY, release the room lock, publish recording-ready.
 *         Raw files are NOT deleted here (cleanup runs later, so a retry has its input).
 */
export async function finalizeRecording(recordingId: string): Promise<void> {
  const recording = await prisma.recording.findUnique({                          // STEP 1
    where: { id: recordingId },
    include: { segments: { orderBy: { index: 'asc' } } },
  });
  if (!recording) throw new Error('Recording not found');
  if (recording.status === 'READY') return;

  const finalDir = path.join(env.recordingDir, recordingId, 'final');            // STEP 2
  await mkdir(finalDir, { recursive: true });

  let ready = 0;

  for (const seg of recording.segments) {                                        // STEP 3
    if (seg.status === 'READY') { ready++; continue; }

    try {
      if ((await stat(seg.rawPath)).size === 0) throw new Error('Raw file is empty');         // a

      const safePeer = seg.peerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
      const name = `${seg.index}-${seg.source}-${safePeer}.mp4`;
      const outPath = path.join(finalDir, name);

      await run(env.ffmpegPath, buildMp4Args(seg.rawPath, outPath, seg.hasVideo, seg.hasAudio));   // b

      const key = await storage.save(outPath, `${recordingId}/final/${name}`);                 // c
      const size = (await stat(outPath)).size;
      const probed = await probeDurationMs(outPath).catch(() => null);                          // d

      await prisma.recordingSegment.update({                                                    // e
        where: { id: seg.id },
        data: {
          status: 'READY', storageKey: key, sizeBytes: BigInt(size),
          durationMs: probed ?? seg.durationMs, error: null,
        },
      });
      ready++;
    } catch (err) {
      logger.error({ err, recordingId, segmentId: seg.id }, 'Segment conversion failed');
      await prisma.recordingSegment.update({
        where: { id: seg.id },
        data: { status: 'FAILED', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
      });
    }
  }

  if (ready === 0) throw new Error('No segment could be converted');            // STEP 4

  await prisma.recording.update({                                                // STEP 5
    where: { id: recordingId },
    data: { status: 'READY', error: null },
  });
  if ((await redis.get(lockKey(recording.roomCode))) === recordingId) {
    await redis.del(lockKey(recording.roomCode));
  }
  await publishRecordingEvent('recording-ready', { roomCode: recording.roomCode, recordingId });
  logger.info({ recordingId, ready, total: recording.segments.length }, 'Recording ready');
}
```

**File:** `services/recording-service/src/queue/finalizeWorker.ts`

```typescript
import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { redisConnection } from './queues.js';
import { finalizeRecording } from '../processing/finalizeRecording.js';
import { markFailed } from '../services/recordingService.js';
import logger from '../utils/logger.js';

/**
 * startFinalizeWorker()
 *
 * STEP 1: One worker for the "recording-finalize" queue, concurrency 1 by default
 *         (transcoding is CPU heavy). Raise FINALIZE_CONCURRENCY only with more CPU.
 * STEP 2: When a job fails, BullMQ retries it (3 attempts). Only after the LAST
 *         attempt is the recording marked FAILED.
 * STEP 3: Exported as a function, so Phase 15 can start it in its own deployment.
 */
export function startFinalizeWorker() {
  const worker = new Worker(
    'recording-finalize',
    async (job) => finalizeRecording(job.data.recordingId as string),
    { connection: redisConnection(), concurrency: env.finalizeConcurrency },     // STEP 1
  );

  worker.on('failed', async (job, err) => {                                      // STEP 2
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    logger.error({ err, recordingId: job.data.recordingId, attempt: job.attemptsMade }, 'finalize job failed');

    if (job.attemptsMade >= attempts) {
      await markFailed(job.data.recordingId as string, err.message);
    }
  });

  worker.on('error', (err) => logger.error({ err }, 'finalize worker error'));
  return worker;                                                                 // STEP 3
}
```

**File:** `services/recording-service/server.ts` (replace)

```typescript
import app from './src/app.js';
import { env } from './src/config/env.js';
import { startFinalizeWorker } from './src/queue/finalizeWorker.js';
import logger from './src/utils/logger.js';

/**
 * server.ts
 *
 * STEP 1: Start the HTTP server.
 * STEP 2: Start the finalize worker in the same process (one container for the MVP).
 * STEP 3: On SIGTERM, close the worker first so a running conversion can end cleanly.
 * Step 10.11 adds: control worker, recovery sweep, cleanup timer.
 */
const server = app.listen(env.port, () => {                                      // STEP 1
  logger.info(`recording-service running on port ${env.port}`);
});

const finalizeWorker = startFinalizeWorker();                                    // STEP 2

process.on('SIGTERM', async () => {                                              // STEP 3
  logger.info('SIGTERM received, shutting down');
  await finalizeWorker.close();
  server.close(() => process.exit(0));
});
```

This step needs the storage driver, so create it first (Step 10.7) or use the stub below and finish it in 10.7.

**Done when** (after Step 10.7 exists)

- After a stop, the recording moves `PROCESSING → READY`. MP4 files exist in `/recordings/<id>/final/`.
- `docker cp recording-service:/recordings/<id>/final ./out` and the `.mp4` plays in a browser, seeking works.
- Break it on purpose (rename the raw `.mkv`, queue again): the segment gets `FAILED` with a message, and with all segments failing the job retries 3 times, then the recording is `FAILED`.
- Commit: `phase-10: step 6 bullmq finalize worker`

---

## Step 10.7: Storage and download

**Why**

- Files must be served safely. A path that comes from the user must never reach the file system. Hiding storage behind a small driver also lets you move to S3 later without touching the controllers.

**How it works**

- A `StorageDriver` has three methods: `save`, `send`, `removeRecording`.
- The **local driver** uses keys relative to `RECORDING_DIR` (`<id>/final/0-camera-xxxx.mp4`) and refuses any path that leaves that folder.
- `send` uses `res.sendFile`, which handles `Range` requests, so the video can seek.
- The download route looks the segment up by **id**, checks that the caller is the owner, and uses only the stored key.
- An S3 driver (later) would upload in `save` and redirect to a short-lived signed URL in `send`.

**Code**

**File:** `services/recording-service/src/storage/index.ts`

```typescript
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { localStorageDriver } from './localStorage.js';

export interface StorageDriver {
  /** Called after conversion. Returns the key saved in the database. */
  save(localPath: string, key: string): Promise<string>;
  /** Streams the file to the response (with Range support). */
  send(key: string, req: Request, res: Response): Promise<void>;
  /** Deletes everything stored for a recording. Must not throw if it is already gone. */
  removeRecording(recordingId: string): Promise<void>;
}

/** STEP: the driver is chosen once, by STORAGE_DRIVER. Only "local" exists for now. */
function pick(): StorageDriver {
  if (env.storageDriver === 'local') return localStorageDriver;
  throw new Error(`Unknown STORAGE_DRIVER "${env.storageDriver}"`);
}

export const storage: StorageDriver = pick();
```

**File:** `services/recording-service/src/storage/localStorage.ts`

```typescript
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import AppError from '../utils/AppError.js';
import type { StorageDriver } from './index.js';

/**
 * resolveSafe(relativeKey)
 *
 * STEP 1: Turn the key into an absolute path under RECORDING_DIR.
 * STEP 2: If the result is outside that folder (for example "../../etc/passwd"),
 *         refuse. This is the one place that guards the file system.
 */
function resolveSafe(relativeKey: string): string {
  const base = path.resolve(env.recordingDir);
  const full = path.resolve(base, relativeKey);                                  // STEP 1
  if (full !== base && !full.startsWith(base + path.sep)) {                      // STEP 2
    throw new AppError('Invalid storage path', 400);
  }
  return full;
}

export const localStorageDriver: StorageDriver = {
  /**
   * save: the converted file is already inside RECORDING_DIR, so only check
   * that the key points to it and return the key.
   */
  async save(localPath, key) {
    if (path.resolve(localPath) !== resolveSafe(key)) throw new Error('Storage key does not match the file location');
    return key;
  },

  /**
   * send: STEP 1 resolve safely. STEP 2 set the MP4 type, and a download name when ?download=1.
   * STEP 3 res.sendFile (handles Range requests). A client that cancels the download is not an error.
   */
  async send(key, req, res) {
    const file = resolveSafe(key);                                               // STEP 1
    res.type('video/mp4');                                                       // STEP 2
    if (req.query.download === '1') res.attachment(path.basename(file));

    await new Promise<void>((resolve, reject) => {                               // STEP 3
      res.sendFile(file, (err: any) => {
        if (!err || err.code === 'ECONNABORTED') resolve();
        else reject(err);
      });
    });
  },

  async removeRecording(recordingId) {
    await rm(resolveSafe(recordingId), { recursive: true, force: true });
  },
};
```

**File:** `services/recording-service/src/controllers/recordingController.ts` (add the import at the top and these two handlers at the bottom)

```typescript
import { storage } from '../storage/index.js';

/**
 * downloadSegmentHandler   -> GET /v1/recordings/:id/segments/:segmentId/download[?download=1]
 *
 * STEP 1: Load the recording (owner check) and find the segment INSIDE it.
 *         The key is never built from user input.
 * STEP 2: The segment must be READY with a storage key, else 409.
 * STEP 3: Stream it. Range requests make seeking work.
 */
export async function downloadSegmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rec = await loadOwned(String(req.params.id), res.locals.userId);                 // STEP 1
    const seg = rec.segments.find((s) => s.id === String(req.params.segmentId));
    if (!seg) throw new AppError('Segment not found', 404);

    if (seg.status !== 'READY' || !seg.storageKey) throw new AppError('Segment is not ready yet', 409);   // STEP 2

    await storage.send(seg.storageKey, req, res);                                          // STEP 3
  } catch (err) {
    if (!(err instanceof AppError)) logger.error({ err }, 'Download failed');
    if (res.headersSent) return;
    next(err instanceof AppError ? err : new AppError('Failed to download segment', 500));
  }
}

/**
 * deleteRecordingHandler   -> DELETE /v1/recordings/:id
 *
 * STEP 1: Owner check.
 * STEP 2: A recording that is still active (STARTING / RECORDING / STOPPING / PROCESSING)
 *         cannot be deleted (409). Stop it and wait until it is READY or FAILED.
 * STEP 3: Delete the files first, then the rows (segments go with it, onDelete: Cascade).
 */
export async function deleteRecordingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rec = await loadOwned(String(req.params.id), res.locals.userId);                 // STEP 1

    if (rec.status !== 'READY' && rec.status !== 'FAILED') {                               // STEP 2
      throw new AppError('Recording is still active', 409);
    }

    await storage.removeRecording(rec.id);                                                 // STEP 3
    await prisma.recording.delete({ where: { id: rec.id } });

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError('Failed to delete recording', 500));
  }
}
```

**File:** `services/recording-service/src/routes/recordingRoutes.ts` (add the two handlers to the import, and the two routes)

```typescript
import { downloadSegmentHandler, deleteRecordingHandler } from '../controllers/recordingController.js';

router.get(
  '/:id/segments/:segmentId/download',
  validate(segmentParamsSchema, 'params'),
  downloadSegmentHandler,
);
router.delete('/:id', validate(idParamsSchema, 'params'), deleteRecordingHandler);
```

**Done when**

- A READY segment downloads with `Invoke-WebRequest -Headers $h -OutFile seg.mp4 <downloadUrl>` and plays.
- A `Range` request returns `206`: `curl.exe -i -H "Authorization: Bearer <token>" -H "Range: bytes=0-99" <url>`.
- Another user's token gets 403. A pending segment gets 409. An unknown segment id gets 404.
- Delete of a READY recording removes the folder and the rows. Delete during `RECORDING` gives 409.
- Commit: `phase-10: step 7 download and storage driver`

---

# PART C: Connect everything (Steps 10.8 to 10.10)

---

## Step 10.8: Gateway proxy

**Why**

- Browsers only know the gateway (`:4000`). It already checks the JWT, so recordings should go through it like rooms do.

**How it works**

- Same rule as rooms: `pathFilter: '/v1/recordings'`, **no** `pathRewrite`.
- `/internal/*` is never mapped, so it returns 404 through the gateway. Only the SFU reaches it, over the Docker network.
- Large downloads and `Range` headers pass through the proxy unchanged.

**Code**

**File:** `services/api-gateway/src/routes/proxyRoutes.ts` (copy the structure of your rooms rule; **ADAPT** the names)

```typescript
/**
 * STEP 1: Same shape as the rooms rule: gatewayAuth first, then the proxy.
 * STEP 2: pathFilter '/v1/recordings', NO pathRewrite (like /v1/rooms).
 * STEP 3: Do not add any rule for "/internal". It must stay unreachable from outside.
 */
app.use(
  '/v1/recordings',                                       // ADAPT: copy exactly how /v1/rooms is mounted
  gatewayAuth,
  createProxyMiddleware({
    target: RECORDING_SERVICE_URL,                        // from env
    changeOrigin: true,
    pathFilter: '/v1/recordings',
  }),
);
```

**File:** `services/api-gateway/src/config/env.ts` (add)

```typescript
export const RECORDING_SERVICE_URL: string = process.env.RECORDING_SERVICE_URL as string;
```

**File:** `services/api-gateway/.env.docker` (add)

```dotenv
RECORDING_SERVICE_URL=http://recording-service:4007
```

**Done when**

- With a token: `GET http://localhost:4000/v1/recordings` returns 200 (an empty list is fine).
- Without a token: 401 from `gatewayAuth`.
- `http://localhost:4000/internal/recordings/x/capture-ended` returns 404.
- Commit: `phase-10: step 8 gateway proxy for recordings`

---

## Step 10.9: Signaling recording events

**Why**

- Everyone in the room must know when recording starts. This is also a privacy rule: people should not be recorded without knowing. The frontend will show a "REC" indicator from these events.

**How it works**

- recording-service publishes events on the Redis channel `recording-events` (same pattern as chat).
- Signaling **subscribes** with its **own** Redis connection (a connection in subscribe mode cannot run other commands) and emits each event to the Socket.io room named by `roomCode`.
- A person who joins **during** a recording gets `recording: { active, recordingId }` in the `joined` event, read from the lock key.
- A bad message must never crash signaling, so parsing is inside a `try/catch`.

**Code**

**File:** `services/signaling-service/src/events/recordingEvents.ts` (new)

```typescript
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { REDIS_URL } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * initRecordingEvents(io)
 *
 * STEP 1: Use a SEPARATE Redis connection. A connection in subscribe mode
 *         cannot run normal commands, so never reuse the shared one.
 * STEP 2: Subscribe to "recording-events".
 * STEP 3: Each message is { type, roomCode, ...payload }.
 *         Emit it to everyone in the Socket.io room named roomCode,
 *         with the event name equal to "type" (recording-started, ...).
 * STEP 4: A bad message is logged, never thrown.
 */
export function initRecordingEvents(io: Server): void {
  const sub = new Redis(REDIS_URL);                                              // STEP 1
  sub.on('error', (err) => logger.error({ err }, 'recording-events subscriber error'));

  sub.subscribe('recording-events', (err) => {                                   // STEP 2
    if (err) logger.error({ err }, 'Could not subscribe to recording-events');
    else logger.info('Subscribed to recording-events');
  });

  sub.on('message', (_channel, raw) => {
    try {
      const { type, roomCode, ...payload } = JSON.parse(raw);                    // STEP 3
      if (typeof type === 'string' && typeof roomCode === 'string') {
        io.to(roomCode).emit(type, payload);
      }
    } catch (err) {
      logger.error({ err }, 'Bad recording event');                              // STEP 4
    }
  });
}
```

**File:** `services/signaling-service/src/socket/index.ts` (add the import, and ONE call inside `initSocket`, outside `io.on('connection')`)

```typescript
import { initRecordingEvents } from '../events/recordingEvents.js';

export function initSocket(io: Server) {
    io.use(socketAuth)
    initRecordingEvents(io)                       // NEW: once per server, not once per socket
    // ...the rest stays the same
}
```

**File:** `services/signaling-service/src/handlers/joinRoom.ts` (inside the `try`, replace the `socket.emit('joined', ...)` part)

```typescript
            /**
             * STEP 5 (extended): a late joiner must learn that a recording is running.
             *         The lock key "recording:active:<roomCode>" holds the recording id.
             */
            const activeRecordingId = await redis.get(`recording:active:${roomCode}`);

            socket.emit('joined', {
                existingMembers: roomMembers,
                mode,
                recording: { active: !!activeRecordingId, recordingId: activeRecordingId ?? undefined },
            })
```

**File:** `services/signaling-service/tests/manual/recording.client.ts` (new, a manual listener)

```typescript
import { io } from 'socket.io-client';

// Usage: npx tsx tests/manual/recording.client.ts <token> <roomCode>
const [token, roomCode] = process.argv.slice(2);

if (!token || !roomCode) {
    console.error('Usage: npx tsx tests/manual/recording.client.ts <token> <roomCode>');
    process.exit(1);
}

/**
 * Joins a room and prints every recording event.
 *
 * STEP 1: Connect and join.
 * STEP 2: "joined" shows recording.active (true when you join during a recording).
 * STEP 3: Print recording-started / stopped / ready / failed as they arrive.
 */
const socket = io('http://localhost:4004', { auth: { token } });

socket.on('connect', () => {
    console.log(`[connected] ${socket.id}`);
    socket.emit('join-room', { roomCode });                                    // STEP 1
});

socket.on('joined', (d) => console.log('[joined]', JSON.stringify(d)));        // STEP 2

for (const name of ['recording-started', 'recording-stopped', 'recording-ready', 'recording-failed']) {
    socket.on(name, (d) => console.log(`[${name}]`, JSON.stringify(d)));        // STEP 3
}

socket.on('join-error', (m) => console.log('[join-error]', m));
socket.on('connect_error', (e) => console.log('[connect_error]', e.message));

process.stdin.resume();
```

**Done when**

- Two clients run `recording.client.ts` in the same room. When the host starts a recording both print `recording-started`. Later both print `recording-stopped` and `recording-ready`.
- A third client that joins **during** the recording prints `[joined]` with `"recording":{"active":true,...}`.
- Signaling logs `Subscribed to recording-events`.
- Commit: `phase-10: step 9 signaling recording events`

---

## Step 10.10: Docker Compose and end-to-end test

**Why**

- Put the new service into the stack and prove the whole chain works with real media, without the frontend.

**How it works**

- `recording-service` and `sfu-service` share the `recordings_data` volume.
- `sfu-service` does **not** depend on `recording-service` (the webhook is best effort and the manifest is the backup).
- The gateway depends on `recording-service` so the proxy target exists.

**Code**

**File:** `docker-compose.yml`

```yaml
  api-gateway:
    depends_on:
      # ...existing...
      - recording-service

  sfu-service:
    environment:
      # ...existing variables...
      - RECORDING_DIR=/recordings
      - RECORDING_SERVICE_URL=http://recording-service:4007
      - RECORDING_RTP_MIN_PORT=50000
      - RECORDING_RTP_MAX_PORT=50200
    volumes:
      - recordings_data:/recordings
    # No new published ports: FFmpeg listens on 127.0.0.1 inside the container only.

  recording-service:
    build: ./services/recording-service
    container_name: recording-service
    restart: unless-stopped
    ports:
      - "4007:4007"                       # dev only, remove in production
    env_file:
      - ./services/recording-service/.env.docker
    environment:
      - INTERNAL_SECRET=${INTERNAL_SECRET}
      - SFU_SERVICE_URL=http://sfu-service:4006
    volumes:
      - recordings_data:/recordings
    depends_on:
      - postgres
      - redis
      - room-service
      - sfu-service

volumes:
  postgres_data:
  mongo_data:
  recordings_data:
```

**File:** `services/recording-service/Dockerfile` (reference; keep the Prisma lines exactly as in room-service)

```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# FFmpeg for the worker. openssl: needed by Prisma on Debian slim.
# /recordings must belong to "node", because the container runs as that user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /recordings \
    && chown node:node /recordings

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate          # ADAPT: copy this line (and any env it needs) from room-service

COPY tsconfig.json server.ts ./
COPY src ./src
RUN npm run build

EXPOSE 4007
USER node

# ADAPT: run migrations the same way room-service does
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

**End-to-end test (backend only):**

1. Build and start everything:

```powershell
docker compose up -d --build sfu-service recording-service signaling-service api-gateway
docker compose logs -f recording-service
```

2. Create a room with the host user (through your room API) and note the `code` and the host's token.
3. Serve the test page: `cd test-client; npx serve .`, then open `http://localhost:3000/sfu-one-click.html?room=<code>`. Enter the secret and click **1. Run full test**. Peer A now sends real camera and mic into the SFU room named after the real room code. **Do not click Part 2 yet.**
4. In two terminals run `recording.client.ts` (two users, same room code) to watch events.
5. Start the recording **through the gateway** as the host:

```powershell
$h = @{ Authorization = "Bearer <hostToken>" }
$r = Invoke-RestMethod -Method Post -Uri http://localhost:4000/v1/recordings/start -Headers $h -ContentType "application/json" -Body '{"roomCode":"<code>"}'
$r.data.recordingId
```

6. Wait 30 seconds, then stop it:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/v1/recordings/$($r.data.recordingId)/stop -Headers $h
```

7. Poll until `READY`:

```powershell
(Invoke-RestMethod -Uri http://localhost:4000/v1/recordings/$($r.data.recordingId) -Headers $h).data
```

8. Download a segment with its `downloadUrl` and play it. Then click **2. Test leave + cleanup** on the page.

**Done when**

- The socket clients printed `recording-started`, `recording-stopped`, `recording-ready` in that order.
- The downloaded MP4 has picture, sound, and seeks.
- `docker compose exec redis redis-cli keys "recording:active:*"` is empty.
- `docker compose exec sfu-service ps aux | grep ffmpeg` shows nothing.
- Commit: `phase-10: step 10 compose and end to end test`

---

# PART D: Hardening (Step 10.11)

**Why**

- Real systems break: services restart in the middle of a recording, the disk fills, a user forgets to stop. Each item below prevents a stuck or lost recording.

| # | Problem                                                  | Fix                                                      |
| :-: | :------------------------------------------------------- | :------------------------------------------------------- |
| 1 | The host forgets to stop                                 | A delayed job stops it after`MAX_RECORDING_MINUTES`    |
| 2 | recording-service was down when the SFU sent the webhook | Recovery reads`manifest.json` from the volume          |
| 3 | A recording is stuck in a middle status                  | The same sweep fixes it or marks it`FAILED`            |
| 4 | Raw files fill the disk                                  | An hourly timer removes raw files of finished recordings |
| 5 | The disk is almost full                                  | Refuse to start a recording                              |

---

### 10.11.1 Disk guard

**Why:** a full disk corrupts every file being written. Check before starting.

**File:** `services/recording-service/src/utils/disk.ts` (new)

```typescript
import { statfs } from 'node:fs/promises';
import { env } from '../config/env.js';
import AppError from './AppError.js';

/**
 * assertDiskSpace()
 *
 * STEP 1: Read free space of the /recordings volume.
 * STEP 2: Less than MIN_FREE_DISK_MB -> 507-style refusal (we use 503: try later).
 * STEP 3: If the check itself fails, do not block recording (log elsewhere, allow).
 */
export async function assertDiskSpace(): Promise<void> {
  try {
    const s = await statfs(env.recordingDir);                                    // STEP 1
    const freeMb = (s.bavail * s.bsize) / (1024 * 1024);
    if (freeMb < env.minFreeDiskMb) {                                            // STEP 2
      throw new AppError(`Not enough free disk space to record (${Math.round(freeMb)} MB free)`, 503);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;                                      // STEP 3
  }
}
```

**File:** `services/recording-service/src/controllers/recordingController.ts` (in `startRecordingHandler`, right after the host check)

```typescript
import { assertDiskSpace } from '../utils/disk.js';

await assertDiskSpace();                                  // STEP 3b: refuse early, before taking the lock
```

---

### 10.11.2 Auto stop (max duration)

**Why:** a forgotten recording would fill the disk. A delayed BullMQ job stops it.

**How it works:** one more queue, `recording-control`, with a delayed job per recording. The job calls the same `requestStop` as the stop button. A manual stop removes the job.

**File:** `services/recording-service/src/queue/controlQueue.ts` (new)

```typescript
import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { redisConnection } from './queues.js';
import { prisma } from '../config/db.js';             // ADAPT: same import as room-service
import { requestStop } from '../services/recordingService.js';
import logger from '../utils/logger.js';

/**
 * controlQueue.ts: delayed "auto-stop" jobs.
 *
 * STEP 1: scheduleAutoStop() adds a job that fires after MAX_RECORDING_MINUTES.
 *         The job id contains the recording id, so it can be removed later.
 * STEP 2: cancelAutoStop() removes it when the host stops the recording in time.
 * STEP 3: The worker calls requestStop(). If the recording is no longer RECORDING,
 *         requestStop() does nothing, so a late job is harmless.
 */
export const controlQueue = new Queue('recording-control', { connection: redisConnection() });

const jobIdOf = (recordingId: string) => `auto-stop-${recordingId}`;

export async function scheduleAutoStop(recordingId: string, roomCode: string): Promise<void> {
  await controlQueue.add(                                                         // STEP 1
    'auto-stop',
    { recordingId, roomCode },
    { jobId: jobIdOf(recordingId), delay: env.maxRecordingMinutes * 60_000, removeOnComplete: true, removeOnFail: 100 },
  );
}

export async function cancelAutoStop(recordingId: string): Promise<void> {
  try {
    await controlQueue.remove(jobIdOf(recordingId));                              // STEP 2
  } catch (err) {
    logger.warn({ err, recordingId }, 'Could not remove auto-stop job');
  }
}

export function startControlWorker() {
  return new Worker(
    'recording-control',
    async (job) => {                                                              // STEP 3
      const { recordingId, roomCode } = job.data as { recordingId: string; roomCode: string };
      const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
      if (rec?.status === 'RECORDING') {
        logger.warn({ recordingId }, 'Max duration reached, stopping the recording');
        await requestStop(recordingId, roomCode);
      }
    },
    { connection: redisConnection() },
  );
}
```

**Wire it:**

**File:** `services/recording-service/src/controllers/recordingController.ts`

```typescript
import { scheduleAutoStop, cancelAutoStop } from '../queue/controlQueue.js';

// in startRecordingHandler, replace the "Step 10.11 adds here" comment:
await scheduleAutoStop(recordingId, roomCode);

// in stopRecordingHandler, replace the "Step 10.11 adds here" comment:
await cancelAutoStop(rec.id);
```

---

### 10.11.3 Recovery sweep

**Why:** if recording-service restarts or misses the webhook, a recording would stay `RECORDING`, `STOPPING` or `PROCESSING` forever.

**How it works:** at boot and every 5 minutes, look at every unfinished recording:

| Situation                                                                                        | Action                                                      |
| :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| `manifest.json` exists and status is `RECORDING` / `STOPPING`                              | Run`ingestCapture` with it (same code as the webhook)     |
| Status`PROCESSING` and segments exist                                                          | Queue the finalize job again (same job id, so no duplicate) |
| Status`PROCESSING`, no segments, no manifest                                                   | `FAILED`                                                  |
| Status`STARTING` older than 2 minutes                                                          | `FAILED`                                                  |
| `RECORDING` / `STOPPING`, the SFU says it is **not** recording it, older than 1 minute | `FAILED` ("Capture lost")                                 |
| `RECORDING` and the SFU says it **is** recording it                                      | Leave it alone                                              |
| The SFU cannot be reached                                                                        | Leave it for the next sweep                                 |

**File:** `services/recording-service/src/services/recovery.ts` (new)

```typescript
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../config/db.js';             // ADAPT: same import as room-service
import { env } from '../config/env.js';
import * as sfu from '../config/sfuClient.js';
import { enqueueFinalize } from '../queue/queues.js';
import { ingestCapture, markFailed } from './recordingService.js';
import type { CaptureBody } from './recordingService.js';
import logger from '../utils/logger.js';

async function readManifest(recordingId: string): Promise<CaptureBody | null> {
  try {
    const raw = await readFile(path.join(env.recordingDir, recordingId, 'manifest.json'), 'utf8');
    return JSON.parse(raw) as CaptureBody;
  } catch {
    return null;
  }
}

/**
 * recoverStuckRecordings()
 *
 * STEP 1: Load every recording that is not READY or FAILED.
 * STEP 2: For each one, follow the table above. Every branch is safe to repeat.
 * STEP 3: One broken recording must not stop the sweep: errors are logged per item.
 */
export async function recoverStuckRecordings(): Promise<void> {
  const stuck = await prisma.recording.findMany({                                  // STEP 1
    where: { status: { in: ['STARTING', 'RECORDING', 'STOPPING', 'PROCESSING'] } },
    include: { segments: { select: { id: true } } },
  });

  for (const rec of stuck) {
    try {                                                                          // STEP 2
      const ageMs = Date.now() - rec.updatedAt.getTime();

      if (rec.status === 'STARTING') {
        if (ageMs > 120_000) await markFailed(rec.id, 'Start did not finish');
        continue;
      }

      if (rec.status === 'PROCESSING') {
        if (rec.segments.length > 0) await enqueueFinalize(rec.id);
        else if (ageMs > 120_000) await markFailed(rec.id, 'No segments were saved');
        continue;
      }

      // RECORDING or STOPPING
      const manifest = await readManifest(rec.id);
      if (manifest) {
        logger.warn({ recordingId: rec.id }, 'Recovering recording from manifest.json');
        await ingestCapture(rec.id, manifest);
        continue;
      }

      const status = await sfu.captureStatus(rec.roomCode).catch(() => null);
      if (!status) continue;                                                       // SFU unreachable: try later
      if (status.active && status.recordingId === rec.id) continue;                // still recording: fine

      if (ageMs > 60_000) await markFailed(rec.id, 'Capture lost (the SFU is not recording it)');
    } catch (err) {
      logger.error({ err, recordingId: rec.id }, 'Recovery failed for one recording');   // STEP 3
    }
  }
}
```

---

### 10.11.4 Raw file cleanup

**Why:** raw MKV files are as big as the originals. After the MP4 files exist they are only needed for retries.

**File:** `services/recording-service/src/services/cleanup.ts` (new)

```typescript
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../config/db.js';             // ADAPT: same import as room-service
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * cleanupRawFiles()
 *
 * STEP 1: Find READY recordings that finished more than RAW_RETENTION_HOURS ago (max 100 per run).
 * STEP 2: Delete their raw/ folder. force: true means "already gone" is fine,
 *         so repeating this every hour is safe.
 * STEP 3: Errors are logged per recording and never stop the loop.
 */
export async function cleanupRawFiles(): Promise<void> {
  const before = new Date(Date.now() - env.rawRetentionHours * 3_600_000);
  const old = await prisma.recording.findMany({                                    // STEP 1
    where: { status: 'READY', stoppedAt: { lt: before } },
    select: { id: true },
    take: 100,
  });

  for (const { id } of old) {
    try {
      await rm(path.join(env.recordingDir, id, 'raw'), { recursive: true, force: true });   // STEP 2
    } catch (err) {
      logger.error({ err, recordingId: id }, 'Raw cleanup failed');                          // STEP 3
    }
  }
}
```

---

### 10.11.5 Start everything in `server.ts`

**File:** `services/recording-service/server.ts` (final version)

```typescript
import app from './src/app.js';
import { env } from './src/config/env.js';
import { startFinalizeWorker } from './src/queue/finalizeWorker.js';
import { startControlWorker } from './src/queue/controlQueue.js';
import { recoverStuckRecordings } from './src/services/recovery.js';
import { cleanupRawFiles } from './src/services/cleanup.js';
import logger from './src/utils/logger.js';

/**
 * server.ts
 *
 * STEP 1: Start the HTTP server.
 * STEP 2: Start the two workers (finalize, auto-stop).
 * STEP 3: Recovery sweep at boot (after 5 s, so the SFU has time to start), then every 5 minutes.
 * STEP 4: Raw file cleanup every hour.
 * STEP 5: On SIGTERM, stop timers and workers, then close the server.
 *
 * The timers use setInterval because there is ONE service instance in the MVP.
 * With several instances (Phase 15), move them to BullMQ job schedulers.
 */
const server = app.listen(env.port, () => {                                       // STEP 1
  logger.info(`recording-service running on port ${env.port}`);
});

const finalizeWorker = startFinalizeWorker();                                     // STEP 2
const controlWorker = startControlWorker();

const safe = (name: string, fn: () => Promise<void>) => () =>
  fn().catch((err) => logger.error({ err }, `${name} failed`));

setTimeout(safe('recovery', recoverStuckRecordings), 5_000);                      // STEP 3
const recoveryTimer = setInterval(safe('recovery', recoverStuckRecordings), 5 * 60_000);
const cleanupTimer = setInterval(safe('cleanup', cleanupRawFiles), 60 * 60_000);  // STEP 4

process.on('SIGTERM', async () => {                                               // STEP 5
  logger.info('SIGTERM received, shutting down');
  clearInterval(recoveryTimer);
  clearInterval(cleanupTimer);
  await Promise.allSettled([finalizeWorker.close(), controlWorker.close()]);
  server.close(() => process.exit(0));
});
```

**Done when**

- **Auto stop:** set `MAX_RECORDING_MINUTES=1`, start a recording, wait. It stops by itself and ends `READY`.
- **Recovery:** start a recording, stop it, and immediately `docker compose stop recording-service`. After 10 s start it again: the manifest is picked up and the recording ends `READY`.
- **Disk guard:** set `MIN_FREE_DISK_MB=99999999`. Start gives 503 with the free-space message. Reset it.
- **Cleanup:** set `RAW_RETENTION_HOURS=0`, wait for the next hour tick (or temporarily call `cleanupRawFiles()` at boot): the `raw/` folder disappears and downloads still work.
- Commit: `phase-10: step 11 hardening and docs`

---

# PART E: Final checks

## Full test matrix

| # | Test                                  | Expected                                                                                     |
| :-: | :------------------------------------ | :------------------------------------------------------------------------------------------- |
| 1 | SFU capture alone (Step 10.4)         | MKV plays with audio and video, lip-sync OK, no leftover ffmpeg                              |
| 2 | Start without a token                 | 401                                                                                          |
| 3 | Start as a non-host                   | 403                                                                                          |
| 4 | Start for an unknown room             | 404                                                                                          |
| 5 | Start twice                           | Second call 409                                                                              |
| 6 | Start with nobody in the call         | 409 "Nobody is in the call yet"                                                              |
| 7 | Full flow: start, 30 s, stop          | `RECORDING → STOPPING → PROCESSING → READY`, MP4 downloads and seeks                    |
| 8 | Socket events                         | All clients in the room get`recording-started`, `recording-stopped`, `recording-ready` |
| 9 | Late joiner                           | `joined.recording.active` is `true`                                                      |
| 10 | Peer leaves mid-recording             | Their segment ends, the recording continues                                                  |
| 11 | Peer joins mid-recording              | A new segment,`startOffsetMs` greater than 0                                               |
| 12 | Screen share starts mid-recording     | A separate`screen` segment                                                                 |
| 13 | Everyone leaves                       | The recording stops by itself (`Router closed`) and still reaches `READY`                |
| 14 | recording-service down at capture end | Manifest on disk, recovery finishes it after restart                                         |
| 15 | Worker error during conversion        | Retries up to 3 times, then`FAILED` with a message                                         |
| 16 | Duplicate webhook                     | One job, no duplicate rows (the second answer is`duplicate`)                               |
| 17 | Download as another user              | 403                                                                                          |
| 18 | `/internal/...` through the gateway | 404                                                                                          |
| 19 | 5 peers recorded together             | SFU CPU stays low, ports freed after stop                                                    |
| 20 | Disk guard                            | Start refused (503) when the volume is almost full                                           |
| 21 | Auto stop                             | A recording stops after`MAX_RECORDING_MINUTES`                                             |
| 22 | Delete during recording               | 409                                                                                          |

## Common problems

| Symptom                                | Cause                                          | Fix                                                                                                                    |
| :------------------------------------- | :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| SFU container exits at start           | `INTERNAL_SECRET` empty or short             | Set it in the root`.env`                                                                                             |
| Webhook returns 401                    | Different secrets in SFU and recording-service | Same value in both                                                                                                     |
| `EACCES` writing to `/recordings`  | Folder not owned by`node`                    | `chown node:node /recordings` in the Dockerfile, then `docker compose down -v` once so the volume is created again |
| Recording stays`STOPPING`            | Webhook lost and no manifest                   | Check`docker compose logs sfu-service`, wait for the recovery sweep (5 min)                                          |
| `PROCESSING` forever                 | Worker not running or Redis error              | Check recording-service logs,`redis-cli keys "bull:recording-finalize:*"`                                            |
| MP4 has no sound                       | `hasAudio` false (mic producer missing)      | Check the segment row and the SDP file in`raw/`                                                                      |
| Prisma`P1001`                        | Wrong`DATABASE_URL` host                     | `postgres` inside Docker, `localhost` outside                                                                      |
| Duplicate recording rows after restart | Recovery ran while the SFU still records       | Expected rule: a recording the SFU still records is left alone                                                         |

## Risks to remember

- The SDP and FFmpeg flags are proven only by Step 10.4. Do not skip it.
- PlainTransports use ports from the worker's range (2 per recorded peer). Enlarge the range for big rooms.
- Disk use is large (about 0.45 GB per hour per 1 Mbps video track, raw plus MP4). Keep the cleanup and the disk guard on.
- One SFU instance only (same limit as Phase 9).
- Show a REC indicator to everyone (Phase F). Do not ship recording without it.

## Later (not in Phase 10)

- **Phase F:** Record button for the host, REC indicator from `recording-started` / `joined.recording`, recordings list, player.
- One combined grid video, using `startOffsetMs` and FFmpeg `xstack` (prototype on a sample first).
- Thumbnails.
- S3 or MinIO storage driver with signed URLs.
- Share a recording with room participants, names from the user-service (`userId` is already in each segment).
- Audio-only mode, pause and resume recording.

## Main checklist update

```diff
- | **Phase 10** | **Recording Service**    |  ⏳ PENDING  | FFmpeg + BullMQ worker queue for async video call recordings. |
+ | **Phase 10** | **Recording Service**    | ✅ COMPLETED | Port 4007, `recording_db`. SFU captures per-peer RTP with FFmpeg (copy mode), BullMQ worker converts to MP4, REST API, Redis events to signaling, auto stop, recovery. Frontend part in Phase F. |
```

Mark ✅ only when the full test matrix above passes.

## Git

```bash
git checkout phase-10-recording-service
# commits already planned, in order:
#   step 1  infra ffmpeg volume and recording db
#   step 2  userId in sfu producers
#   step 3a recording ports and sdp helpers
#   step 3b segment recorder
#   step 3c manifest and webhook
#   step 3d recording manager and hooks
#   step 3e sfu recording endpoints
#   step 4  sfu recording test
#   step 5  recording service skeleton and api
#   step 6  bullmq finalize worker
#   step 7  download and storage driver
#   step 8  gateway proxy for recordings
#   step 9  signaling recording events
#   step 10 compose and end to end test
#   step 11 hardening and docs
```

## Definition of done

- Only the host can start and stop a recording, through the gateway.
- Every participant, including late joiners and screen shares, is captured.
- After stop, MP4 files appear, play with sound, and seek.
- All clients in the room get the recording events, and late joiners see the state.
- Nothing leaks: no leftover FFmpeg, ports freed, Redis lock released, raw files cleaned later.
- Failures end in `FAILED` with a message, never stuck in a middle status.
- All 22 tests in the matrix pass.
- `/internal/*` is unreachable through the gateway.

## Where you are right now

1. Run the Step 10.3.1 check (SDP script, `tsc`) and commit it.
2. Build 10.3.2 to 10.3.6 in order, then test everything in Step 10.4 before touching recording-service.
