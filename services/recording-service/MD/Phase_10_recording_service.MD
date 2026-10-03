
# Phase 10 — Recording Service: Design, Contracts & Build Guide

> **Status:** ⏳ Not started. Phase 9 (SFU) is complete, so this is the next backend phase.
> **Goal:** the host presses Record, the call is captured on the server, and after the call the host gets downloadable MP4 files.
> **How to use this file:** it holds the design, the contracts (API, events, DB) and the critical code. The full code for each step is written step by step while you build, the same way as Phase 9.

---

## 0. Quick facts (names to use)

| Item                                   | Value                                                                                                                               |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| **New service folder**           | `services/recording-service`                                                                                                      |
| **Existing folders that change** | `services/sfu-service`, `services/signaling-service`, `services/api-gateway`, `docker-compose.yml`, `infra/postgres-init` |
| **Branch name**                  | `phase-10-recording-service`                                                                                                      |
| **This file**                    | `md/phase-10-recording-service.md`                                                                                                |
| **New service port**             | `4007`                                                                                                                            |
| **Database**                     | Postgres`recording_db` (Prisma)                                                                                                   |
| **Queue**                        | BullMQ on the existing Redis, queue name`recording-finalize`                                                                      |
| **Gateway path**                 | `/api/v1/recordings/*` → recording-service                                                                                       |
| **Storage (MVP)**                | Docker volume`recordings_data` mounted at `/recordings` (S3 later)                                                              |
| **Redis channel**                | `recording-events`                                                                                                                |
| **Stack**                        | TypeScript, Express, Prisma, BullMQ, ioredis, FFmpeg, Pino, Joi, JWT                                                                |

---

## 1. Scope

**In scope (Phase 10, backend only)**

- Host starts and stops a recording through REST.
- SFU captures every participant's audio and video on the server.
- A BullMQ worker converts the captures to MP4 files, stores them, and saves metadata.
- Download and list endpoints.
- Everyone in the room is told when recording starts and stops (REC indicator data).

**Out of scope for now**

- Record button, REC indicator, recordings list and player UI → **Phase F (frontend)**.
- One combined grid video of all participants → stretch goal (section 10).
- S3 storage, sharing with participants, retention policy → stretch goals.

---

## 2. Design decisions (and why)

| # | Decision                                                                     | Why                                                                                                                                                                           |
| :-: | :--------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Capture runs inside `sfu-service`**, not in the new service        | Routers and Producers live in the SFU process. Only the SFU can create a`PlainTransport` and consume a Producer                                                             |
| 2 | **FFmpeg runs in `-c copy` mode inside the SFU container**           | No decoding or encoding, so CPU use is tiny. RTP goes over loopback (`127.0.0.1`), so no extra network setup                                                                |
| 3 | **Raw capture format is MKV (Matroska)**                               | Accepts VP8, H264 and Opus. Survives a crash or kill (MP4 does not)                                                                                                           |
| 4 | **Heavy work (transcode to MP4) runs in the recording-service worker** | Keeps CPU load away from live calls. The worker can be scaled or moved separately in Phase 15                                                                                 |
| 5 | **BullMQ is used for post-processing, not for live capture**           | Capture must start*now*, so it is a direct call. Finalizing is slow and must retry, so it is a queue job. This changes your old checklist wording slightly (see section 11) |
| 6 | **One FFmpeg process per "segment"**                                   | A segment is one peer's camera + mic together (one SDP, so FFmpeg keeps lip-sync using RTCP), or one screen share                                                             |
| 7 | **Output is one MP4 per segment, not one combined video**              | Joins, leaves and mute gaps make a combined layout hard. Per-segment files are simple and correct. A grid video is a stretch goal                                             |
| 8 | **One active recording per room**                                      | Enforced with a Redis lock (`SET NX`)                                                                                                                                       |
| 9 | **SFU tells recording-service when capture ends (webhook)**            | One code path for manual stop, room empty, and errors. A`manifest.json` on disk is the backup if the webhook fails                                                          |
| 10 | **Status changes are broadcast with Redis Pub/Sub**                    | Same pattern as chat. Signaling subscribes and tells the room                                                                                                                 |
| 11 | **Server-side recording, not browser `MediaRecorder`**               | Works if the host closes the tab, records everyone consistently, and needs no frontend logic                                                                                  |

---

## 3. Architecture

```mermaid
flowchart LR
    Host["Host browser"]
    GW["API Gateway :4000<br/>gatewayAuth"]
    Rec["Recording Service :4007<br/>REST + BullMQ worker"]
    SFU["SFU Service :4006<br/>PlainTransport + FFmpeg (copy)"]
    Sig["Signaling :4004"]
    Room["Room Service :4003"]
    Redis[("Redis<br/>lock + queue + events")]
    PG[("Postgres<br/>recording_db")]
    Vol[("Volume<br/>/recordings")]
    Peers["Other participants"]

    Host -- "POST /api/v1/recordings/start" --> GW --> Rec
    Rec -- "host check" --> Room
    Rec -- "start/stop + x-internal-secret" --> SFU
    SFU -- "raw .mkv + manifest" --> Vol
    SFU -- "capture-ended webhook" --> Rec
    Rec <--> PG
    Rec <--> Redis
    Rec -- "finalize job" --> Redis
    Rec -- "reads raw, writes mp4" --> Vol
    Rec -- "recording-events" --> Redis
    Redis --> Sig
    Sig -- "recording-started / stopped / ready" --> Peers
```

### 3.1 Start and stop flow

```mermaid
sequenceDiagram
    participant H as Host
    participant R as Recording Service
    participant S as SFU
    participant Q as BullMQ worker
    participant X as Redis

    H->>R: POST /recordings/start { roomCode }
    R->>R: verify JWT, host check, Redis lock
    R->>S: POST /recordings/start { roomId, recordingId }
    S->>S: PlainTransport + consumer + FFmpeg per peer
    S-->>R: 200 { started }
    R->>X: publish recording-started
    R-->>H: 201 { recordingId, status: RECORDING }
    H->>R: POST /recordings/:id/stop
    R->>S: POST /recordings/stop
    S->>S: stop FFmpeg, write manifest.json
    S->>R: POST /internal/recordings/:id/capture-ended { segments }
    R->>X: publish recording-stopped, enqueue finalize job
    X->>Q: finalize job
    Q->>Q: ffmpeg to mp4, thumbnail, store, update DB
    Q->>X: publish recording-ready
```

### 3.2 Recording status machine

| Status         | Meaning                                     | Next                         |
| :------------- | :------------------------------------------ | :--------------------------- |
| `STARTING`   | Row created, SFU call in progress           | `RECORDING` or `FAILED`  |
| `RECORDING`  | Capture is running                          | `STOPPING`                 |
| `STOPPING`   | Stop requested, waiting for the SFU webhook | `PROCESSING` or `FAILED` |
| `PROCESSING` | Finalize job is queued or running           | `READY` or `FAILED`      |
| `READY`      | MP4 files are available                     | —                           |
| `FAILED`     | Something broke,`error` has the reason    | —                           |

---

## 4. Contracts

### 4.1 Public REST API (through the gateway, JWT required)

| Method | URL                                                     | Body             | Success                            | Errors                                                                |
| :----- | :------------------------------------------------------ | :--------------- | :--------------------------------- | :-------------------------------------------------------------------- |
| POST   | `/api/v1/recordings/start`                            | `{ roomCode }` | 201`{ recordingId, status }`     | 401 no token, 403 not host, 404 room not found, 409 already recording |
| POST   | `/api/v1/recordings/:id/stop`                         | —               | 202`{ status: 'STOPPING' }`      | 403, 404, 409 not recording                                           |
| GET    | `/api/v1/recordings?roomCode=`                        | —               | 200`[recording]`                 | 401                                                                   |
| GET    | `/api/v1/recordings/:id`                              | —               | 200`{ recording, segments }`     | 403, 404                                                              |
| GET    | `/api/v1/recordings/:id/segments/:segmentId/download` | —               | 200 MP4 stream (supports`Range`) | 403, 404, 409 not ready                                               |
| DELETE | `/api/v1/recordings/:id`                              | —               | 200`{ deleted: true }`           | 403, 404                                                              |

MVP rule: only the user who started the recording (the host) can see, download, or delete it.

### 4.2 Internal API of recording-service (never through the gateway)

| Method | URL                                        | Caller | Purpose                                                                        |
| :----- | :----------------------------------------- | :----- | :----------------------------------------------------------------------------- |
| POST   | `/internal/recordings/:id/capture-ended` | SFU    | Receives the segment list, queues the finalize job. Needs`x-internal-secret` |
| GET    | `/health`                                | Docker | `{ status: 'ok', service: 'recording-service' }`                             |

### 4.3 New SFU endpoints (under `/api/v1/sfu`, need `x-internal-secret`)

| Method | URL                            | Body                        | Returns (`data`)                                      |
| :----- | :----------------------------- | :-------------------------- | :------------------------------------------------------ |
| POST   | `/recordings/start`          | `{ roomId, recordingId }` | `{ started: true, segments: number }`                 |
| POST   | `/recordings/stop`           | `{ roomId, recordingId }` | `{ stopping: true }` (idempotent)                     |
| GET    | `/recordings/:roomId/status` | —                          | `{ active: boolean, recordingId?, segments: number }` |

Errors: 404 room has no Router (nobody is in the call), 409 room already recording, 400 bad input.

### 4.4 SFU → recording-service webhook body

```json
{
  "recordingStartedAtMs": 1791012000000,
  "recordingEndedAtMs": 1791012300000,
  "segments": [
    {
      "index": 0,
      "peerId": "O6L8FyYlLc4TLbY-AAAD",
      "userId": "4a18f082-994b-4d4e-b153-d763f5b976ae",
      "source": "camera",
      "hasVideo": true,
      "hasAudio": true,
      "file": "/recordings/<recordingId>/raw/0-O6L8F...-camera.mkv",
      "startedAtMs": 1791012001500,
      "endedAtMs": 1791012299800
    }
  ]
}
```

The same body is saved as `/recordings/<recordingId>/manifest.json` **before** the webhook is sent.

### 4.5 Redis

| Item            | Value                                                                                                             |
| :-------------- | :---------------------------------------------------------------------------------------------------------------- |
| Lock key        | `recording:active:{roomCode}` = `recordingId`, set with `NX` and a 4 hour expiry, deleted when capture ends |
| Pub/Sub channel | `recording-events`                                                                                              |
| Event body      | `{ type, roomCode, recordingId, startedBy? }`                                                                   |
| Event types     | `recording-started`, `recording-stopped`, `recording-ready`, `recording-failed`                           |
| BullMQ queue    | `recording-finalize`, job id `finalize-{recordingId}` (a duplicate webhook cannot enqueue twice)              |

### 4.6 Socket events (signaling → browsers in the room)

| Event                                  | Payload                                                                             |
| :------------------------------------- | :---------------------------------------------------------------------------------- |
| `recording-started`                  | `{ recordingId, startedBy }`                                                      |
| `recording-stopped`                  | `{ recordingId }`                                                                 |
| `recording-ready`                    | `{ recordingId }`                                                                 |
| `recording-failed`                   | `{ recordingId }`                                                                 |
| `joined` (existing event, new field) | `{ existingMembers, mode, recording: { active: boolean, recordingId?: string } }` |

### 4.7 Database schema

**File:** `services/recording-service/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum RecordingStatus {
  STARTING
  RECORDING
  STOPPING
  PROCESSING
  READY
  FAILED
}

enum SegmentStatus {
  PENDING
  READY
  FAILED
}

model Recording {
  id         String          @id @default(uuid())
  roomCode   String
  startedBy  String          // userId of the host
  status     RecordingStatus @default(STARTING)
  startedAt  DateTime        @default(now())
  stoppedAt  DateTime?
  durationMs Int?
  thumbKey   String?         // storage key of the thumbnail
  error      String?
  segments   RecordingSegment[]
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt

  @@index([roomCode])
  @@index([startedBy])
}

model RecordingSegment {
  id            String        @id @default(uuid())
  recordingId   String
  recording     Recording     @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  index         Int
  peerId        String        // socket id at capture time
  userId        String?       // from the SFU producer appData
  source        String        // 'camera' | 'screen'
  hasVideo      Boolean
  hasAudio      Boolean
  startOffsetMs Int           // relative to the recording start
  durationMs    Int?
  rawPath       String
  storageKey    String?       // final mp4 key
  sizeBytes     Int?
  status        SegmentStatus @default(PENDING)
  error         String?

  @@index([recordingId])
}
```

---

## 5. File structure

### 5.1 New service

```
services/recording-service/
├── server.ts                        ← boots HTTP server + BullMQ worker
├── package.json                     ← "type": "module"
├── tsconfig.json
├── Dockerfile                       ← installs ffmpeg, creates /recordings owned by node
├── .env / .env.docker
├── prisma/schema.prisma
└── src/
    ├── app.ts
    ├── config/
    │   ├── env.ts                   ← fails at startup if secrets are missing
    │   ├── redis.ts
    │   ├── roomServiceClient.ts     ← host check (same pattern as signaling)
    │   └── sfuClient.ts             ← start / stop / status, x-internal-secret, 5s timeout
    ├── controllers/
    │   ├── recordingController.ts   ← start, stop, list, get, download, delete
    │   └── internalController.ts    ← capture-ended webhook
    ├── routes/
    │   ├── recordingRoutes.ts
    │   └── internalRoutes.ts
    ├── middleware/
    │   ├── authGuard.ts             ← verifies the user JWT (JWT_ACCESS_SECRET)
    │   ├── internalGuard.ts         ← verifies x-internal-secret (same code as the SFU authGuard)
    │   ├── errorHandler.ts
    │   └── validate.ts
    ├── validation/recordingSchemas.ts
    ├── queue/
    │   ├── queues.ts                ← connection + finalizeQueue
    │   └── finalizeWorker.ts        ← Worker, importable on its own for Phase 15
    ├── processing/
    │   ├── ffmpeg.ts                ← run ffmpeg/ffprobe, return a Promise
    │   └── finalizeRecording.ts     ← the job logic
    ├── storage/
    │   ├── index.ts                 ← driver chosen by STORAGE_DRIVER
    │   └── localStorage.ts
    ├── events/publisher.ts          ← publish to recording-events
    └── utils/ (AppError.ts, logger.ts)
```

### 5.2 New files in the SFU

```
services/sfu-service/src/
├── recording/
│   ├── recordingManager.ts          ← per-room state, start/stop, reconcile, hooks
│   ├── segmentRecorder.ts           ← PlainTransport + consumer + FFmpeg for one segment
│   ├── sdp.ts                       ← builds the SDP text FFmpeg reads
│   ├── ports.ts                     ← hands out FFmpeg RTP ports
│   └── manifest.ts                  ← writes manifest.json, sends the webhook
├── controllers/recordingController.ts
└── (edited) config/env.ts, routes/sfuRoutes.ts, validation/sfuSchemas.ts,
             mediasoup/producerManager.ts, mediasoup/peerManager.ts, mediasoup/roomManager.ts
```

### 5.3 Other files that change

| File                                                                                        | Change                                             |
| :------------------------------------------------------------------------------------------ | :------------------------------------------------- |
| `services/signaling-service/src/config/sfuClient.ts` and `handlers/sfu.ts`              | Pass`userId` on `produce`                      |
| `services/signaling-service/src/handlers/joinRoom.ts`                                     | Add`recording` to the `joined` payload         |
| `services/signaling-service/src/socket/index.ts` (or a new `events/recordingEvents.ts`) | Subscribe to`recording-events`, emit to the room |
| `services/api-gateway`                                                                    | Proxy`/api/v1/recordings/*`                      |
| `docker-compose.yml`                                                                      | New service, volume, env                           |
| `infra/postgres-init`                                                                     | Create`recording_db`                             |

---

## 6. Build plan (step by step)

### Step 10.0 — Before you code

- [ ] Merge Phase 9 into `main`, then create the branch:

```bash
git checkout main
git merge phase-9-sfu-service
git checkout -b phase-10-recording-service
```

- [ ] **Check the room response.** Open `GET /v1/rooms/:code` in room-service and note which field holds the host's user id (`hostId`? a participant with role `HOST`?). The host check in Step 10.5 depends on it.
- [ ] **Look at your gateway's rooms proxy rule.** The recordings rule copies its path rewrite style.
- [ ] Decide storage: local volume now, S3 later.

### Step 10.1 — Infra preparation

**Goal:** FFmpeg and a shared writable folder exist before any code uses them.

1. **Create the database.** Init scripts only run on a fresh Postgres volume. If your volume already exists, run it by hand:

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE recording_db;"
```

Also add `CREATE DATABASE recording_db;` to your init script in `infra/postgres-init` so a fresh setup has it.

2. **SFU Dockerfile: install FFmpeg and create the folder.** Docker copies the image folder's owner into a new named volume, so the folder must be owned by `node` before `USER node`.

**File:** `services/sfu-service/Dockerfile` (runtime stage, after `WORKDIR /app`, before `USER node`)

```dockerfile
# STEP: FFmpeg for recording. Used in "-c copy" mode only, so CPU use stays low.
# STEP: /recordings must belong to "node", because the container runs as that user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /recordings \
    && chown node:node /recordings
```

3. **SFU env.**

**File:** `services/sfu-service/src/config/env.ts` (add to the `env` object)

```typescript
/**
 * STEP: Recording settings.
 *   recordingDir        where raw MKV files and manifest.json are written
 *   recordingServiceUrl where the capture-ended webhook is sent
 *   recordingRtpMin/Max UDP ports FFmpeg listens on (127.0.0.1 only).
 *                       Keep this range DIFFERENT from RTC_MIN_PORT/RTC_MAX_PORT,
 *                       or a port clash can break a transport.
 *   ffmpegPath          binary name, "ffmpeg" in the image
 */
recordingDir: process.env.RECORDING_DIR || '/recordings',
recordingServiceUrl: process.env.RECORDING_SERVICE_URL || 'http://recording-service:4007',
recordingRtpMin: Number(process.env.RECORDING_RTP_MIN_PORT) || 50000,
recordingRtpMax: Number(process.env.RECORDING_RTP_MAX_PORT) || 50200,
ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
```

4. **Compose: volume and SFU env.** See section 7.

**Done when**

- `docker compose up -d --build sfu-service`
- `docker compose exec sfu-service ffmpeg -version` prints a version
- `docker compose exec sfu-service sh -c "touch /recordings/t && ls -l /recordings && rm /recordings/t"` works

### Step 10.2 — Carry `userId` into the SFU

**Goal:** the manifest can say which user a file belongs to. Signaling knows the `userId`, the SFU does not.

**File:** `services/signaling-service/src/config/sfuClient.ts`

```typescript
export function produce(
    roomId: string, peerId: string, transportId: string,
    kind: string, rtpParameters: unknown, source: string,
    userId?: string,                                              // CHANGE: new optional arg
) {
    return request<{ producerId: string }>(
        'POST', '/produce', { roomId, peerId, transportId, kind, rtpParameters, source, userId },
    );
}
```

**File:** `services/signaling-service/src/handlers/sfu.ts` (inside the `produce` handler)

```typescript
const result = await sfu.produce(
    roomCode, socket.id, transportId, kind, rtpParameters, source,
    socket.data.userId as string,                                  // CHANGE: from the verified JWT, never from the client
);
```

**File:** `services/sfu-service/src/validation/sfuSchemas.ts` (inside `produceSchema`)

```typescript
userId: Joi.string().trim().max(128).optional(),
```

**File:** `services/sfu-service/src/controllers/produceController.ts`

```typescript
// STEP: read userId from the body and pass it on
const { roomId, peerId, transportId, kind, rtpParameters, source, userId } = req.body ?? {};
// ...
const producer = await createProducer(peer, transportId, kind, rtpParameters, source, userId);
```

**File:** `services/sfu-service/src/mediasoup/producerManager.ts`

```typescript
// signature: add  userId?: string  as the last parameter
producer = await transport.produce({
    kind,
    rtpParameters,
    appData: { peerId: peer.id, source, userId },   // CHANGE: userId stored on the producer
});
```

**Done when:** the existing `sfu-one-click.html` Part 1 and `sfu.client.ts` still pass (the field is optional).

### Step 10.3 — SFU recorder module (the technical core)

**Goal:** given a room, capture every peer's media into MKV files, and keep working when peers join, leave, or start a screen share.

#### 10.3.1 How one segment is captured

For one segment (for example Peer A's camera + mic):

1. For **each** producer, create a `PlainTransport` (loopback, `rtcpMux: true`, `comedia: false`) and `connect()` it to `127.0.0.1:<ffmpegPort>`.
2. `transport.consume({ producerId, rtpCapabilities: router.rtpCapabilities, paused: true })`.
3. Build an SDP file from the consumers' `rtpParameters`, with one `m=` section per consumer.
4. Spawn FFmpeg on that SDP. It binds the UDP ports and waits for RTP.
5. Wait about 800 ms so FFmpeg is listening, then `consumer.resume()` and `consumer.requestKeyFrame()`.
6. Call `requestKeyFrame()` again every 10 seconds (clean cut points, easier seeking).
7. On stop: send `SIGINT` to FFmpeg (it writes the file end), wait up to 10 s, `SIGKILL` as a fallback, then close the consumers and transports and free the ports.

**Why one PlainTransport per consumer:** a PlainTransport sends to one remote ip:port. Audio and video go to different FFmpeg ports, so each needs its own transport.

**Port budget:** each PlainTransport takes one port from the **worker's** `RTC_MIN_PORT..RTC_MAX_PORT` range, the same pool as your WebRTC transports. A recorded peer uses 2 extra ports (camera + mic). Plan the range: 100 ports is about 25 peers total. Raise the range (and the compose publish range) if you record large rooms. Optional: mediasoup lets a listen info carry its own `portRange`. If your type definitions accept it, use a separate unpublished range for PlainTransports.

#### 10.3.2 Segment rules

| Situation                                                   | What happens                                                                                                     |
| :---------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Recording starts                                            | One`camera` segment per peer that has a camera and/or mic producer. One `screen` segment per screen producer |
| Peer joins during recording                                 | New producers arrive. Wait 1.5 s (so camera and mic settle together), then start a segment                       |
| A producer in a segment closes (mic or camera removed)      | That segment stops. A new segment starts for the producers that remain                                           |
| New producer added to a running peer (camera enabled later) | The running segment stops and a new one starts with the new set                                                  |
| Peer leaves                                                 | Transports close, producers close, the segment stops                                                             |
| Room becomes empty (`closeRoom`)                          | All segments stop and the recording ends (webhook with reason)                                                   |
| Stop requested                                              | All segments stop,`manifest.json` is written, the webhook is sent                                              |

The usual case (everyone joins once and stays) gives **one segment per peer**, so most recordings are one clean MP4 per person.

The mechanism is a small `reconcile(peer)` function: compute the desired producer set per group, compare it with the running segment, and stop and restart only if they differ. A per-peer 1.5 s debounce timer calls it.

#### 10.3.3 SDP builder

**File:** `services/sfu-service/src/recording/sdp.ts`

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
 *         "a=rtcp-mux" tells FFmpeg that RTP and RTCP share the port,
 *         which matches rtcpMux: true on the PlainTransport.
 *
 * STEP 3: Use the first codec that is NOT rtx. Its payload type, clock
 *         rate (and channels for audio) must be exactly what mediasoup sends.
 *
 * STEP 4: Copy the codec parameters into "a=fmtp". H264 needs them
 *         (packetization-mode, profile-level-id).
 *
 * No a=sendonly / a=recvonly line on purpose. Unknown direction lines
 * add risk and bring no benefit here.
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

#### 10.3.4 One segment: start and stop

**File:** `services/sfu-service/src/recording/segmentRecorder.ts`

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type * as mediasoup from 'mediasoup';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';
import { buildSdp, type SdpMedia } from './sdp.ts';
import { allocPort, freePort } from './ports.ts';

export interface ActiveSegment {
  index: number;
  peerId: string;
  userId?: string;
  source: 'camera' | 'screen';
  hasVideo: boolean;
  hasAudio: boolean;
  producerIds: string[];
  file: string;
  startedAtMs: number;
  stop(): Promise<{ endedAtMs: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * startSegment(opts)
 *
 * STEP 1: For every producer, take a free port, create a PlainTransport,
 *         connect it to 127.0.0.1:<port>, and create a PAUSED consumer.
 *         Consume with router.rtpCapabilities so the codec stays exactly
 *         what the browser sent (no transcoding in the SFU).
 *
 * STEP 2: Write the SDP file and start FFmpeg in copy mode into an MKV file.
 *
 * STEP 3: Wait 800 ms so FFmpeg has opened its UDP ports, THEN resume the
 *         consumers. Resuming earlier loses the first packets.
 *
 * STEP 4: Ask for a key frame now, and every 10 seconds after that.
 *
 * STEP 5: Return a handle. stop() ends FFmpeg gracefully (SIGINT), waits up
 *         to 10 s, then kills it, then closes everything and frees the ports.
 */
export async function startSegment(opts: {
  router: mediasoup.types.Router;
  dir: string;                       // /recordings/<recordingId>/raw
  index: number;
  peerId: string;
  userId?: string;
  source: 'camera' | 'screen';
  producers: mediasoup.types.Producer[];
}): Promise<ActiveSegment> {
  const { router, dir, index, peerId, userId, source, producers } = opts;
  const parts: {
    kind: 'audio' | 'video';
    port: number;
    transport: mediasoup.types.PlainTransport;
    consumer: mediasoup.types.Consumer;
  }[] = [];

  const closeAll = () => {
    for (const p of parts) {
      try { p.consumer.close(); } catch { /* already closed */ }
      try { p.transport.close(); } catch { /* already closed */ }
      freePort(p.port);
    }
  };

  try {
    // STEP 1
    for (const producer of producers) {
      const port = allocPort();
      const transport = await router.createPlainTransport({
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

    const ff: ChildProcess = spawn(
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

    ff.stderr?.on('data', (d) => logger.warn({ peerId, ffmpeg: String(d).trim() }, 'ffmpeg'));
    const exited = new Promise<void>((resolve) => ff.once('exit', () => resolve()));
    ff.once('error', (err) => logger.error({ err, peerId }, 'ffmpeg failed to start'));

    // STEP 3
    await sleep(800);
    for (const p of parts) await p.consumer.resume();
    const startedAtMs = Date.now();

    // STEP 4
    const askKeyFrames = () => {
      for (const p of parts) if (p.kind === 'video') p.consumer.requestKeyFrame().catch(() => undefined);
    };
    askKeyFrames();
    const keyTimer = setInterval(askKeyFrames, 10_000);

    // STEP 5
    let stopped = false;
    return {
      index, peerId, userId, source,
      hasVideo: parts.some((p) => p.kind === 'video'),
      hasAudio: parts.some((p) => p.kind === 'audio'),
      producerIds: producers.map((p) => p.id),
      file,
      startedAtMs,
      async stop() {
        if (stopped) return { endedAtMs: Date.now() };
        stopped = true;
        clearInterval(keyTimer);
        const endedAtMs = Date.now();
        ff.kill('SIGINT');
        const timeout = sleep(10_000).then(() => ff.kill('SIGKILL'));
        await Promise.race([exited, timeout]);
        closeAll();
        return { endedAtMs };
      },
    };
  } catch (err) {
    closeAll();
    throw err;
  }
}
```

#### 10.3.5 Port pool

**File:** `services/sfu-service/src/recording/ports.ts`

```typescript
import { env } from '../config/env.ts';

/**
 * allocPort() / freePort(port)
 *
 * STEP 1: Keep a Set of ports in use, between recordingRtpMin and recordingRtpMax.
 * STEP 2: allocPort() returns the first free port, or throws when the pool is empty.
 * STEP 3: freePort() puts it back. Calling it twice is harmless.
 */
const used = new Set<number>();

export function allocPort(): number {
  for (let p = env.recordingRtpMin; p <= env.recordingRtpMax; p++) {
    if (!used.has(p)) {
      used.add(p);
      return p;
    }
  }
  throw new Error('No free recording RTP port');
}

export function freePort(port: number): void {
  used.delete(port);
}
```

#### 10.3.6 Recording manager (API and hooks)

**File:** `services/sfu-service/src/recording/recordingManager.ts` (write this file with the contract below, full code is built in the step)

```typescript
/**
 * Public API
 *
 *   startRecording(roomId, recordingId)  -> { segments: number }
 *       404 if the room has no Router, 409 if the room is already recording.
 *       Creates /recordings/<id>/raw, then reconcile() for every peer.
 *
 *   stopRecording(roomId, recordingId, reason)  -> void   (idempotent)
 *       Stops every segment, writes manifest.json, sends the webhook.
 *
 *   getRecordingStatus(roomId)  -> { active, recordingId?, segments }
 *
 * Hooks (called from existing code, they do nothing when the room is not recording)
 *
 *   onProducerCreated(peer, producer)   from producerManager.createProducer
 *   onProducerClosed(peer, producerId)  from producer.observer.on('close')
 *   onRoomClosed(roomId)                from roomManager.closeRoom (reason: 'room-empty')
 *
 * Internal
 *
 *   reconcile(room, peer)   desired producers per group ("camera": camera video + mic audio,
 *                           "screen": screen video) compared with the running segment.
 *                           Same set -> keep. Different -> stop old, start new.
 *                           Debounced 1500 ms per peer.
 */
```

**Small additions to existing files**

**File:** `services/sfu-service/src/mediasoup/peerManager.ts`

```typescript
// STEP: the recorder needs to walk all peers of a room
export function listRoomPeers(roomId: string): Peer[] {
    return [...(rooms.get(roomId)?.values() ?? [])];
}
```

**File:** `services/sfu-service/src/mediasoup/producerManager.ts` (inside `createProducer`)

```typescript
import { onProducerCreated, onProducerClosed } from '../recording/recordingManager.ts';

// after peer.producers.set(producer.id, producer):
onProducerCreated(peer, producer);                       // CHANGE: tell the recorder

// inside the existing producer.observer.on('close', ...) handler:
onProducerClosed(peer, producer.id);                     // CHANGE
```

**File:** `services/sfu-service/src/mediasoup/roomManager.ts` (start of `closeRoom`, before closing the Router)

```typescript
import { onRoomClosed } from '../recording/recordingManager.ts';

await onRoomClosed(roomId);   // CHANGE: stop the recording first so FFmpeg is not left running
```

Note: `onRoomClosed` must run **before** `router.close()`, because closing the Router closes the PlainTransports.

#### 10.3.7 Manifest and webhook

**File:** `services/sfu-service/src/recording/manifest.ts` (contract)

```typescript
/**
 * finishRecording(recordingId, body)
 *
 * STEP 1: Write /recordings/<recordingId>/manifest.json (the backup).
 * STEP 2: POST body to  <recordingServiceUrl>/internal/recordings/<recordingId>/capture-ended
 *         with x-internal-secret and a 5 s timeout.
 * STEP 3: On failure retry 3 times (1 s, 3 s, 9 s). After that only log it.
 *         The manifest stays on disk and recording-service recovers it on boot (Step 10.11).
 */
```

#### 10.3.8 Endpoints and validation

- `POST /recordings/start`, `POST /recordings/stop`, `GET /recordings/:roomId/status` in `controllers/recordingController.ts`.
- Register them in `routes/sfuRoutes.ts` behind `validate(...)`, as with the other routes.
- Add `startRecordingSchema` and `stopRecordingSchema` (`roomId`, `recordingId`) to `validation/sfuSchemas.ts`.
- `recordingId` must be a UUID (`Joi.string().guid()`), because it becomes a folder name. This also blocks path tricks.

### Step 10.4 — Test the SFU recorder alone (no new service yet)

**Add Part 4 to `test-client/sfu-one-click.html`:**

1. Peer A joins and produces camera + mic (reuse Part 1).
2. `POST /recordings/start { roomId, recordingId: <uuid> }` → 200, `segments: 1`.
3. Wait 10 seconds.
4. `GET /recordings/:roomId/status` → `active: true`.
5. `POST /recordings/start` again → 409.
6. `POST /recordings/stop` → 200. Stop twice → 200 (idempotent).

**Then inspect the files:**

```bash
docker compose exec sfu-service ls -lh /recordings/<recordingId>/raw
docker compose exec sfu-service ffprobe -hide_banner /recordings/<recordingId>/raw/0-<peerId>-camera.mkv
docker cp sfu-service:/recordings/<recordingId>/raw ./out        # then play the .mkv in VLC
docker compose exec sfu-service cat /recordings/<recordingId>/manifest.json
docker compose logs sfu-service | findstr /i "webhook ffmpeg"     # the webhook fails now, that is expected
```

**Done when**

- The `.mkv` plays in VLC with video **and** audio, and lip-sync looks right (clap test).
- `ffprobe` shows a video stream and an audio stream.
- Stopping leaves no `ffmpeg` process: `docker compose exec sfu-service ps aux | grep ffmpeg` is empty.
- After the room empties (`Router closed`), the recording stopped by itself and the manifest exists.
- Ports are freed: start and stop 5 times in a row without `No free recording RTP port`.

### Step 10.5 — recording-service skeleton

**Goal:** a service that owns the product logic: who may record, the database rows, the lock, and the calls to the SFU.

1. Create the folder, `package.json` (`"type": "module"`), `tsconfig.json`, and install: `express prisma @prisma/client bullmq ioredis jsonwebtoken axios joi pino helmet dotenv`. Copy `AppError`, `logger`, `errorHandler`, `validate` from another service.
2. Add `prisma/schema.prisma` (section 4.7) and run `npx prisma migrate dev --name init`.
3. **`config/env.ts`**: `PORT=4007`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `ROOM_SERVICE_URL`, `SFU_SERVICE_URL`, `INTERNAL_SECRET` (at least 16 characters, fail at startup), `RECORDING_DIR`, `STORAGE_DRIVER`, `FINALIZE_CONCURRENCY`, `MAX_RECORDING_MINUTES`, `RAW_RETENTION_HOURS`.
4. **`middleware/authGuard.ts`**: verify the user JWT with `JWT_ACCESS_SECRET` (same approach as signaling's `socketAuth`), set `req.userId`.
5. **`middleware/internalGuard.ts`**: copy the SFU `authGuard` (SHA-256 + `timingSafeEqual`).
6. **`config/sfuClient.ts`**: `startCapture`, `stopCapture`, `captureStatus`. Same style as signaling's `sfuClient.ts` (secret header, 5 s timeout, errors keep the status).
7. **`config/roomServiceClient.ts`**: copy signaling's `getActiveRoom(code, token)`.

**Start logic (`recordingController.startRecording`)**

```typescript
/**
 * startRecording(req, res, next)   -> POST /v1/recordings/start
 *
 * STEP 1: Read roomCode. The user id comes from the verified JWT.
 * STEP 2: Ask Room Service for the room (with the caller's token).
 *         Not found or ended -> 404.
 * STEP 3: Host check. Compare the room's host id with the caller. Not host -> 403.
 *         (Use the field you found in Step 10.0.)
 * STEP 4: Take the lock:  SET recording:active:{roomCode} <id> NX EX 14400
 *         Not acquired -> 409 "Already recording".
 * STEP 5: Insert the Recording row with status STARTING.
 * STEP 6: Call the SFU start. On any error: delete the lock, mark FAILED, rethrow.
 *         SFU 404 means nobody is in the call, so answer 409 "Room is empty".
 * STEP 7: Mark RECORDING, publish recording-started, schedule the auto-stop job (Step 10.11).
 * STEP 8: Respond 201 { recordingId, status: 'RECORDING' }.
 */
```

**Stop logic (`recordingController.stopRecording`)**

```typescript
/**
 * stopRecording(req, res, next)   -> POST /v1/recordings/:id/stop
 *
 * STEP 1: Load the recording. Not found -> 404. startedBy !== caller -> 403.
 * STEP 2: Status must be RECORDING, otherwise 409 (stopping twice is not an error
 *         for the SFU, but the user should know it is already stopping).
 * STEP 3: Set status STOPPING.
 * STEP 4: Call the SFU stop. It answers fast; the real result comes through the webhook.
 * STEP 5: Respond 202 { status: 'STOPPING' }.
 */
```

**Webhook logic (`internalController.captureEnded`)**

```typescript
/**
 * captureEnded(req, res, next)   -> POST /internal/recordings/:id/capture-ended
 *
 * STEP 1: Load the recording. Unknown id -> 404.
 * STEP 2: Idempotent: if status is already PROCESSING / READY / FAILED, answer 200 and stop.
 * STEP 3: Release the lock (DEL recording:active:{roomCode}) and publish recording-stopped.
 * STEP 4: No segments in the body -> mark FAILED ("No media captured"), publish recording-failed.
 * STEP 5: Insert one RecordingSegment per item (startOffsetMs = segment.startedAtMs - recordingStartedAtMs).
 * STEP 6: Set status PROCESSING, stoppedAt, durationMs.
 * STEP 7: Enqueue the finalize job with jobId finalize-<recordingId>.
 * STEP 8: Respond 200.
 */
```

**Done when:** with the SFU running and a room with one peer producing, `POST /recordings/start` with the host's token returns 201, and `stop` leads the row to `PROCESSING`. Check all the error codes in the table in section 4.1.

### Step 10.6 — BullMQ queue and finalize worker

**File:** `services/recording-service/src/queue/queues.ts`

```typescript
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

/**
 * queues.ts
 *
 * STEP 1: BullMQ workers need maxRetriesPerRequest: null on their Redis connection.
 *         Without it the worker throws on startup.
 * STEP 2: attempts 3 with exponential backoff, so a temporary ffmpeg or disk error
 *         is retried before the job counts as failed.
 * STEP 3: Keep a short history of finished and failed jobs for debugging.
 */
export const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });   // STEP 1

export const finalizeQueue = new Queue('recording-finalize', {
  connection,
  defaultJobOptions: {                                                                  // STEP 2
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,                                                              // STEP 3
    removeOnFail: 500,
  },
});

// Use this when the webhook arrives. The job id makes a duplicate webhook harmless.
export function enqueueFinalize(recordingId: string) {
  return finalizeQueue.add('finalize', { recordingId }, { jobId: `finalize-${recordingId}` });
}
```

**File:** `services/recording-service/src/queue/finalizeWorker.ts`

```typescript
import { Worker } from 'bullmq';
import { connection } from './queues.js';
import { env } from '../config/env.js';
import { finalizeRecording } from '../processing/finalizeRecording.js';

/**
 * Worker: runs finalizeRecording(recordingId) for each job.
 * Concurrency 1 by default, because transcoding is CPU heavy.
 * The final failure (all attempts used) marks the recording FAILED.
 * Exported as a function so Phase 15 can start it in its own deployment.
 */
export function startFinalizeWorker() {
  const worker = new Worker(
    'recording-finalize',
    async (job) => finalizeRecording(job.data.recordingId as string),
    { connection, concurrency: env.finalizeConcurrency },
  );

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      // mark FAILED + publish recording-failed (see finalizeRecording.markFailed)
    }
  });

  return worker;
}
```

**Finalize logic (`processing/finalizeRecording.ts`)**

```typescript
/**
 * finalizeRecording(recordingId)
 *
 * STEP 1: Load the recording and its PENDING segments.
 * STEP 2: For each segment:
 *         a) ffprobe the raw MKV for the real duration (skip with an error if the file is missing or empty).
 *         b) Convert to MP4 with the args below, into /recordings/<id>/final/<index>-<peerId>-<source>.mp4
 *         c) Store it with the storage driver (local: keep in place, S3 later: upload then delete the local copy)
 *         d) Update the segment: storageKey, sizeBytes, durationMs, status READY
 *         One bad segment is marked FAILED but does NOT stop the others.
 * STEP 3: Make a thumbnail from the first segment that has video:
 *         ffmpeg -ss 1 -i <final.mp4> -frames:v 1 <thumb.jpg>
 * STEP 4: If at least one segment is READY: recording READY, publish recording-ready.
 *         If none: recording FAILED, publish recording-failed.
 * STEP 5: Raw files are NOT deleted now. A repeatable cleanup job removes them after RAW_RETENTION_HOURS
 *         (Step 10.11), so a failed run can be retried from the same raw files.
 */
```

**FFmpeg arguments for the MP4 conversion**

```typescript
/**
 * buildMp4Args(input, output, hasVideo, hasAudio)
 *
 * -c:v libx264 -preset veryfast -crf 23   good quality, fast encode
 * -pix_fmt yuv420p                         plays everywhere
 * -vf scale=trunc(iw/2)*2:trunc(ih/2)*2    libx264 needs EVEN width and height.
 *                                          Screen shares are often odd-sized.
 * -c:a aac -b:a 128k                       MP4-friendly audio (the raw track is Opus)
 * -movflags +faststart                     lets the browser start playing before the full download
 */
export function buildMp4Args(input: string, output: string, hasVideo: boolean, hasAudio: boolean): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-i', input];
  if (hasVideo) args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
  args.push('-movflags', '+faststart', output);
  return args;
}
```

**Recording-service Dockerfile** needs FFmpeg and the folder:

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /recordings && chown node:node /recordings
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json server.ts ./
COPY src ./src
RUN npm run build
EXPOSE 4007
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

(`openssl` is needed by Prisma on Debian slim. Adjust to match how your other Prisma services start and migrate.)

**Done when:** after a stop, the recording moves `PROCESSING` → `READY`, MP4 files exist under `/recordings/<id>/final/`, and they play in a browser.

### Step 10.7 — Download and storage

**Storage driver contract** (`storage/index.ts`):

```typescript
export interface StorageDriver {
  /** Called after conversion. Returns the key saved in the DB. */
  save(localPath: string, key: string): Promise<string>;
  /** Streams the file to the response with Range support. */
  send(key: string, req: Request, res: Response): Promise<void>;
  /** Deletes a stored file. Must not throw if it is already gone. */
  remove(key: string): Promise<void>;
}
```

- **Local driver (MVP):** the key is the path under `/recordings`. `send` uses `res.sendFile(path)`, which handles `Range` requests so the video can seek.
- **Security:** never build the path from user input. Look up the segment row by `id`, check `recording.startedBy === req.userId`, then use only the stored key.
- Headers: `Content-Type: video/mp4`, and `Content-Disposition: attachment` when `?download=1` is set.
- **S3 driver (stretch):** `@aws-sdk/client-s3`, `save` uploads and deletes the local file, `send` redirects to a short-lived presigned URL. MinIO works as a local S3 for testing.

### Step 10.8 — Gateway proxy

**File:** your gateway's routes file (copy the style of the existing `/api/v1/rooms` rule)

```typescript
/**
 * STEP 1: Recordings are a protected API, so gatewayAuth runs first.
 * STEP 2: Proxy to recording-service. Keep the same path rewrite style as your rooms rule.
 * STEP 3: Never proxy "/internal/*". Only the SFU may call it, over the Docker network.
 *
 * ADAPT: the exact createProxyMiddleware options must match your rooms rule.
 */
app.use(
  '/api/v1/recordings',
  gatewayAuth,
  createProxyMiddleware({
    target: process.env.RECORDING_SERVICE_URL,   // http://recording-service:4007
    changeOrigin: true,
    // pathRewrite: copy from the rooms rule so /api/v1/recordings/x becomes /v1/recordings/x
  }),
);
```

Also add `RECORDING_SERVICE_URL=http://recording-service:4007` to `services/api-gateway/.env.docker`.

**Done when:** `GET http://localhost:4000/api/v1/recordings` with a token returns 200, without a token returns 401, and `http://localhost:4000/internal/...` returns 404.

### Step 10.9 — Signaling: recording events

**Goal:** everyone in the room learns that recording started, stopped, or is ready.

**File:** `services/signaling-service/src/socket/index.ts` (or `events/recordingEvents.ts`, called from `initSocket(io)`)

```typescript
import Redis from 'ioredis';
import { REDIS_URL } from '../config/env.js';

/**
 * initRecordingEvents(io)
 *
 * STEP 1: A Redis connection in subscribe mode cannot run normal commands.
 *         Use a separate connection (new Redis(...)), do not reuse the shared one.
 *
 * STEP 2: Subscribe to "recording-events".
 *
 * STEP 3: Each message is { type, roomCode, recordingId, startedBy? }.
 *         Emit it to the Socket.io room named roomCode with the same event name as "type".
 *         Wrap JSON.parse in try/catch: a bad message must not crash signaling.
 */
export function initRecordingEvents(io: Server) {
  const sub = new Redis(REDIS_URL);                                   // STEP 1
  sub.subscribe('recording-events');                                  // STEP 2

  sub.on('message', (_channel, raw) => {
    try {
      const { type, roomCode, ...payload } = JSON.parse(raw);        // STEP 3
      io.to(roomCode).emit(type, payload);
    } catch (err) {
      logger.error({ err }, 'Bad recording event');
    }
  });
}
```

**File:** `services/signaling-service/src/handlers/joinRoom.ts` (late joiners must see the REC state)

```typescript
// STEP 5 (extend): read the active recording before sending "joined"
const activeRecordingId = await redis.get(`recording:active:${roomCode}`);

socket.emit('joined', {
    existingMembers: roomMembers,
    mode,
    recording: { active: !!activeRecordingId, recordingId: activeRecordingId ?? undefined },
})
```

**Done when:** `tests/manual/recording.client.ts` (two clients in one room) prints `recording-started` on both when the host starts, `recording-stopped` and `recording-ready` later, and a third client that joins during recording gets `recording.active: true` in `joined`.

### Step 10.10 — Compose and end-to-end test

See section 7 for the compose changes. Then:

```bash
docker compose up -d --build sfu-service recording-service signaling-service api-gateway
docker compose logs -f recording-service
```

End-to-end run (backend only, with the manual scripts and `sfu-one-click.html`):

1. Two users join a room (`sfu.client.ts`), one user's browser produces real media.
2. Host calls `POST /api/v1/recordings/start` through the gateway.
3. Both script clients print `recording-started`.
4. Wait 30 seconds, then host calls `stop`.
5. Poll `GET /api/v1/recordings/:id` until `READY`.
6. Download a segment and play it.

### Step 10.11 — Hardening

- [ ] **Auto stop (max duration).** On start, add a delayed BullMQ job (`MAX_RECORDING_MINUTES`) that calls the same stop logic if the recording is still `RECORDING`. This prevents forever-running captures.
- [ ] **Recovery on boot.** When recording-service starts: for every row in `RECORDING` or `STOPPING`, ask the SFU `GET /recordings/:roomId/status`. If the SFU is not recording it, look for `/recordings/<id>/manifest.json`. If it exists, run the same code as the webhook. If not, mark `FAILED`.
- [ ] **Stuck lock.** The Redis lock has a 4 hour expiry, and the recovery step deletes it.
- [ ] **Raw cleanup job.** A repeatable BullMQ job (every hour) deletes raw MKV and SDP files of `READY` recordings older than `RAW_RETENTION_HOURS`.
- [ ] **Disk guard.** Refuse to start a recording when the `/recordings` volume has less than a set amount of free space (for example 2 GB). Answer 507 or 503.
- [ ] **Consent.** The REC indicator must be shown to everyone (Phase F). Keep `startedBy` and timestamps in the DB as an audit trail.

---

## 7. Docker Compose and env

**File:** `docker-compose.yml`

```yaml
  sfu-service:
    environment:
      # ...existing variables...
      - RECORDING_DIR=/recordings
      - RECORDING_SERVICE_URL=http://recording-service:4007
      - RECORDING_RTP_MIN_PORT=50000
      - RECORDING_RTP_MAX_PORT=50200
    volumes:
      - recordings_data:/recordings
    # No new published ports. FFmpeg ports are loopback inside the container only.

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

- Do **not** make `sfu-service` depend on `recording-service`. The webhook is best effort and the manifest is the backup.
- `JWT_ACCESS_SECRET` must be identical to the one in auth, signaling and the gateway.

**File:** `services/recording-service/.env.docker`

```dotenv
PORT=4007
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/recording_db
REDIS_URL=redis://redis:6379
JWT_ACCESS_SECRET=<same as the other services>
ROOM_SERVICE_URL=http://room-service:4003
RECORDING_DIR=/recordings
STORAGE_DRIVER=local
FINALIZE_CONCURRENCY=1
MAX_RECORDING_MINUTES=240
RAW_RETENTION_HOURS=24
```

---

## 8. Testing plan

| # | Test                                  | Expected                                                                              |
| :-: | :------------------------------------ | :------------------------------------------------------------------------------------ |
| 1 | SFU capture alone (Step 10.4)         | MKV plays with audio and video, lip-sync OK, no leftover ffmpeg process               |
| 2 | Start without a token                 | 401                                                                                   |
| 3 | Start as a non-host                   | 403                                                                                   |
| 4 | Start for an unknown room             | 404                                                                                   |
| 5 | Start twice                           | Second call 409                                                                       |
| 6 | Start with an empty room              | 409 "Room is empty"                                                                   |
| 7 | Full flow: start → 30 s → stop      | `RECORDING` → `STOPPING` → `PROCESSING` → `READY`, MP4 downloads and seeks |
| 8 | Socket events                         | All clients in the room get`recording-started` / `stopped` / `ready`            |
| 9 | Late joiner                           | `joined.recording.active` is `true`                                               |
| 10 | Peer leaves mid-recording             | Their segment ends, the recording continues, others are fine                          |
| 11 | Peer joins mid-recording              | A new segment appears,`startOffsetMs` is greater than 0                             |
| 12 | Screen share starts mid-recording     | A separate`screen` segment                                                          |
| 13 | Everyone leaves                       | Recording stops by itself (`Router closed`), still reaches `READY`                |
| 14 | recording-service down at capture end | Manifest is on disk, recovery on boot completes the recording                         |
| 15 | Worker crash during finalize          | BullMQ retries (up to 3 attempts), then`FAILED` with an error message               |
| 16 | Duplicate webhook                     | Only one job (same`jobId`), no double rows                                          |
| 17 | Download as another user              | 403                                                                                   |
| 18 | `/internal/...` through the gateway | 404                                                                                   |
| 19 | 5 peers recorded together             | CPU stays low in the SFU, ports are freed after stop                                  |
| 20 | Disk guard                            | Start refused when the volume is almost full                                          |

---

## 9. Risks and limits

| # | Risk                                                                        | What to do                                                                                                                      |
| :-: | :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| 1 | The exact SDP and FFmpeg flags are only proven by testing                   | Do Step 10.4 first. If FFmpeg prints no input, check ports, payload types, and that the SDP matches`consumer.rtpParameters`   |
| 2 | Lip-sync can drift if audio and video are in separate processes             | That is why camera + mic share one SDP and one process. Test with a clap                                                        |
| 3 | The PlainTransports use ports from the worker's range                       | Size the range (section 6, Step 10.3.1)                                                                                         |
| 4 | Disk use is large                                                           | About 0.45 GB per hour per 1 Mbps video track, plus the MP4 copies. Use retention and the disk guard                            |
| 5 | Transcoding is CPU heavy                                                    | It runs in the worker with concurrency 1. Scale the worker separately later                                                     |
| 6 | Resolution changes during a call (bandwidth adaptation)                     | The MP4 filter scales to the first frame size. Check one long recording                                                         |
| 7 | An SFU restart during recording loses the raw files that were not finalized | MKV keeps what was written. Recovery marks the recording`FAILED` if there is no manifest                                      |
| 8 | Only one SFU instance                                                       | The same limit as Phase 9. Multi-instance needs shared storage and a room-to-instance map                                       |
| 9 | Privacy and consent                                                         | Everyone must be told. Do not ship recording without the REC indicator in the UI                                                |
| 10 | `PlainTransport` options differ slightly between mediasoup versions       | You use 3.27. If the type checker rejects`listenInfo`, check the `createPlainTransport` types in `node_modules/mediasoup` |

---

## 10. Later (not in Phase 10)

**Phase F (frontend)**

- Record button for the host, with a confirmation.
- REC indicator in every participant's UI, driven by `recording-started` / `stopped` and `joined.recording`.
- Recordings list page, status badge (`PROCESSING`, `READY`), video player with seek.

**Stretch goals**

- One combined grid video: place the segments on a timeline with `startOffsetMs` and build the layout with FFmpeg `xstack`. Prototype it on a sample first, because people joining and leaving at different times needs careful handling.
- S3 or MinIO storage with presigned URLs.
- Share a recording with room participants.
- Names on files and in the UI through the user-service profile (`userId` is already in each segment).
- Audio-only recording mode.
- Pause and resume recording.

---

## 11. Main checklist changes

**Dashboard row**

```diff
- | **Phase 10** | **Recording Service**    |  ⏳ PENDING  | FFmpeg + BullMQ worker queue for async video call recordings. |
+ | **Phase 10** | **Recording Service**    |  ⏳ PENDING  | Port 4007, `recording_db`. SFU captures per-peer RTP with FFmpeg (copy mode); BullMQ worker converts to MP4 and stores metadata; REST + Redis events. Guide: `md/phase-10-recording-service.md`. |
```

**Phase 10 steps in the checklist (replace the diagram)**

```mermaid
flowchart TD
    S1["Step 10.1<br/>Infra: recording_db, FFmpeg, /recordings volume"] --> S2["Step 10.2<br/>userId in SFU producers"]
    S2 --> S3["Step 10.3<br/>SFU recorder: PlainTransport + FFmpeg"]
    S3 --> S4["Step 10.4<br/>Test SFU capture alone"]
    S4 --> S5["Step 10.5<br/>recording-service: start/stop/webhook"]
    S5 --> S6["Step 10.6<br/>BullMQ finalize worker (MP4)"]
    S6 --> S7["Step 10.7<br/>Download + storage"]
    S7 --> S8["Step 10.8<br/>Gateway proxy"]
    S8 --> S9["Step 10.9<br/>Signaling: recording events"]
    S9 --> S10["Step 10.10<br/>Compose + end-to-end test"]
    S10 --> S11["Step 10.11<br/>Hardening"]
```

---

## 12. Git checkpoints

```bash
git checkout main
git merge phase-9-sfu-service
git checkout -b phase-10-recording-service
```

Commits, in order:

- `phase-10: step 1 infra ffmpeg volume and recording db`
- `phase-10: step 2 userId in sfu producers`
- `phase-10: step 3 sfu recorder module`
- `phase-10: step 4 sfu recording test`
- `phase-10: step 5 recording service skeleton and api`
- `phase-10: step 6 bullmq finalize worker`
- `phase-10: step 7 download and storage driver`
- `phase-10: step 8 gateway proxy for recordings`
- `phase-10: step 9 signaling recording events`
- `phase-10: step 10 compose and end to end test`
- `phase-10: step 11 hardening and docs`

---

## 13. Definition of done

- Host can start and stop a recording through the gateway, and only the host.
- Every participant (including late joiners and screen shares) is captured.
- After stop, MP4 files appear and play with sound, with working seek.
- All clients in the room get `recording-started`, `recording-stopped`, `recording-ready`.
- Nothing leaks: no leftover FFmpeg process, ports freed, Redis lock released.
- Failures end in `FAILED` with an error message, never stuck in a middle status.
- Tests 1 to 20 in section 8 pass.
- `/internal/*` is not reachable through the gateway.

---

## 14. Next action

1. Do Step 10.0: merge Phase 9, create the branch, and note the host field of the room response.
2. Do Step 10.1: database, Dockerfile, env, volume.
3. Then build Step 10.3 and test it alone (Step 10.4) before writing any recording-service code. If the SFU capture plays correctly in VLC, the rest of the phase is ordinary service work.
