
# Phase 9 — SFU Service: Progress & Pending Work

> **Branch:** `phase-9-sfu-service`
> **Service folder:** `services/sfu-service` (Port `4006`)
> **Stack:** TypeScript, Express, Mediasoup v3, Pino
> **Import style:** Normal TS imports, bina extension (`'../config/env'`). `package.json` mein `"type": "module"` **nahi** hai (CommonJS mode).

---

## 1. Status Dashboard

| Step | Kya banega                                         |                    Status                    |
| :--: | :------------------------------------------------- | :-------------------------------------------: |
|  1  | Skeleton (`server.ts`, `app.ts`, `/health`)  |                    ✅ Done                    |
|  2  | Docker (`Dockerfile`, compose entry)             | ✅ Done (env vars update baaki, neeche dekho) |
|  3  | Mediasoup config (`config/mediasoup.ts`)         |                    ✅ Done                    |
|  4  | Worker pool (`workerPool.ts`)                    |                    ✅ Done                    |
|  5  | Room manager +`GET /router-capabilities/:roomId` |                    ✅ Done                    |
|  6  | Transports + Produce API                           |                    ⏳ Next                    |
|  7  | Consume + Resume API                               |                  ⏳ Pending                  |
|  8  | Signaling service se integration                   |                  ⏳ Pending                  |
|  9  | Frontend (`mediasoup-client`)                    |                  ⏳ Pending                  |
|  10  | Multi-tab testing (4-5 users)                      |                  ⏳ Pending                  |
|  11  | Hardening (auth, cleanup, docs)                    |                  ⏳ Pending                  |

---

## 2. Ab tak kya bana hai (Done)

```
services/sfu-service/
├── server.ts                        ← pehle workers start, phir HTTP server
├── package.json
├── tsconfig.json
├── .env                             ← PORT, NUM_WORKERS, RTC ports, ANNOUNCED_IP
├── Dockerfile
└── src/
    ├── app.ts                       ← /health + /api/v1/sfu routes + errorHandler
    ├── config/
    │   ├── env.ts                   ← saari env variables
    │   └── mediasoup.ts             ← codecs (Opus, VP8, H264), ports, listenInfos
    ├── mediasoup/
    │   ├── workerPool.ts            ← C++ workers, round-robin getNextWorker()
    │   └── roomManager.ts           ← roomId → Router (getOrCreateRouter, closeRoom)
    ├── controllers/
    │   └── routerController.ts      ← router capabilities return karta hai
    ├── routes/
    │   └── sfuRoutes.ts
    ├── middleware/
    │   └── errorHandler.ts
    └── utils/
        ├── logger.ts
        └── AppError.ts
```

**Working API abhi:**

| Method | URL                                         | Result                                       |
| :----- | :------------------------------------------ | :------------------------------------------- |
| GET    | `/health`                                 | `{ "status": "ok" }`                       |
| GET    | `/api/v1/sfu/router-capabilities/:roomId` | Router ke codecs (`routerRtpCapabilities`) |

**Verified:** 2 workers start hote hain (alag pid), aur ek room ke liye Router sirf ek baar banta hai.

---

## 3. Pending Work (kya karna hai, kis order mein)

### Step 6 — Transports + Produce API

**Goal:** Browser apni camera/mic SFU ko bhej sake (upload path).

**Kyun:** Transport = browser aur server ke beech ka pipe. Har user ko 2 chahiye: **send** (upload) aur **recv** (download). Producer = uploaded track.

**Nayi files:**

| File                                       | Kaam                                                               |
| :----------------------------------------- | :----------------------------------------------------------------- |
| `src/mediasoup/peerManager.ts`           | Room → peer → { transports, producers, consumers } ka data store |
| `src/mediasoup/transportManager.ts`      | `router.createWebRtcTransport()` aur `transport.connect()`     |
| `src/mediasoup/producerManager.ts`       | `transport.produce()` aur producers ki list                      |
| `src/controllers/transportController.ts` | HTTP handlers for transports                                       |
| `src/controllers/produceController.ts`   | HTTP handler for produce                                           |

**Endpoints:**

| Method | URL                                | Body                                                     | Returns                                                  |
| :----- | :--------------------------------- | :------------------------------------------------------- | :------------------------------------------------------- |
| POST   | `/api/v1/sfu/transports`         | `{ roomId, peerId, direction: 'send' \| 'recv' }`       | `{ id, iceParameters, iceCandidates, dtlsParameters }` |
| POST   | `/api/v1/sfu/transports/connect` | `{ roomId, peerId, transportId, dtlsParameters }`      | `{ connected: true }`                                  |
| POST   | `/api/v1/sfu/produce`            | `{ roomId, peerId, transportId, kind, rtpParameters }` | `{ producerId }`                                       |
| GET    | `/api/v1/sfu/producers/:roomId`  | (none)                                                   | Room ke existing producers (naye joiner ke liye)         |

**Zaroori points:**

- `createWebRtcTransport` mein `mediasoupConfig.webRtcTransport` use karo (`listenInfos` + `announcedAddress`).
- Transport banate waqt `enableUdp: true`, `enableTcp: true`, `preferUdp: true` rakho.
- Har transport, producer ko `peerId` ke saath store karo, taaki leave hone pe cleanup ho sake.

**Test:** `POST /transports` se `iceParameters`, `iceCandidates`, `dtlsParameters` aana chahiye.

---

### Step 7 — Consume + Resume API

**Goal:** Browser dusre users ki video download kar sake.

**Nayi files:**

| File                                     | Kaam                                   |
| :--------------------------------------- | :------------------------------------- |
| `src/mediasoup/consumerManager.ts`     | `recvTransport.consume()` aur resume |
| `src/controllers/consumeController.ts` | HTTP handlers                          |

**Endpoints:**

| Method | URL                             | Body                                                | Returns                                     |
| :----- | :------------------------------ | :-------------------------------------------------- | :------------------------------------------ |
| POST   | `/api/v1/sfu/consume`         | `{ roomId, peerId, producerId, rtpCapabilities }` | `{ id, producerId, kind, rtpParameters }` |
| POST   | `/api/v1/sfu/consumer/resume` | `{ roomId, peerId, consumerId }`                  | `{ resumed: true }`                       |

**Zaroori points:**

- Pehle check: `router.canConsume({ producerId, rtpCapabilities })`. False ho to `AppError(400)`.
- Consumer ko `paused: true` pe banao, browser ready hone ke baad `resume` karo (warna pehle frames miss ho jate hain).
- Apna hi producer khud consume mat karo (`producer.peerId !== peerId` check).

**Test:** `POST /consume` se valid consumer parameters aane chahiye.

---

### Step 8 — Signaling Service se jodna

**Goal:** Browser Socket.io se baat kare, Signaling service andar se SFU ko HTTP call kare.

**Flow:** `Browser ↔ Signaling (Socket.io) ↔ SFU (HTTP) ↔ Mediasoup`

**Kahan:** `services/signaling-service`

**Naye Socket.io events:**

| Event (client → server)        | SFU call                                                   |
| :------------------------------ | :--------------------------------------------------------- |
| `get-router-capabilities`     | `GET /router-capabilities/:roomId`                       |
| `create-transport`            | `POST /transports`                                       |
| `connect-transport`           | `POST /transports/connect`                               |
| `produce`                     | `POST /produce`, phir room ko `new-producer` broadcast |
| `consume`                     | `POST /consume`                                          |
| `resume-consumer`             | `POST /consumer/resume`                                  |
| `leave-room` / `disconnect` | `POST /peers/leave` (cleanup)                            |

**Server → client events:** `router-capabilities`, `transport-created`, `produced`, `consumed`, `new-producer`, `producer-closed`.

**Naye users ke liye:** Join karte hi existing producers ki list (`GET /producers/:roomId`) bhejo, taaki wo pehle se maujood logon ko consume kar sakein.

**Env add karo (signaling):** `SFU_SERVICE_URL=http://sfu-service:4006`

---

### Step 9 — Frontend (`mediasoup-client`)

**Goal:** Browser mein SFU mode.

```bash
npm i mediasoup-client
```

**Kya banana hai:**

1. `Device` load karo `routerRtpCapabilities` se.
2. Send transport banao (`device.createSendTransport`), camera + mic `produce()` karo.
3. Recv transport banao (`device.createRecvTransport`).
4. `new-producer` event pe `consume()` karo, `resume` karo, video tile dikhao.
5. **Mode switch:** 2 users ho to purana Mesh, 3rd user aate hi SFU mode.

**Zaroori points:**

- `transport.on('connect')` mein `connect-transport` emit karo.
- `transport.on('produce')` mein `produce` emit karo aur callback mein `producerId` do.
- Video aur audio ko alag `MediaStream` track ke saath attach karo.

---

### Step 10 — Testing

- [ ] 2 tabs: dono ko ek dusre ki video/audio dikhe
- [ ] 3 tabs: SFU mode switch sahi ho
- [ ] 4-5 tabs: sabko sabki video dikhe
- [ ] Ek user leave kare: baaki ki video chalti rahe, uski tile hat jaye
- [ ] Sab leave karein: Router band ho (`closeRoom`)
- [ ] Browser refresh: naya join clean ho, purani state leak na ho

---

### Step 11 — Hardening

- [ ] **Internal auth:** Signaling se aane wale calls pe `x-internal-secret` header check karo (`middleware/authGuard.ts`).
- [ ] SFU ko API Gateway se **public mat karo**. Sirf internal Docker network se access ho.
- [ ] **Cleanup:** Peer leave/disconnect pe uske transports, producers, consumers close karo. Room khali ho to `closeRoom(roomId)`.
- [ ] Validation: request body check karo (Joi ya manual), galat input pe `AppError(400)`.
- [ ] Logs: har major event (transport created, produced, consumed) log karo.
- [ ] Docs update karo: `services/sfu-service/md/readme.md`.
- [ ] Main checklist mein Phase 9 ko ✅ COMPLETED mark karo.

---

## 4. Docker Pending Items

`docker-compose.yml` ke `sfu-service` mein ye environment variables add karo:

```yaml
    environment:
      - PORT=4006
      - NODE_ENV=development
      - NUM_WORKERS=2
      - RTC_MIN_PORT=40000
      - RTC_MAX_PORT=40100
      - ANNOUNCED_IP=127.0.0.1
    ports:
      - "4006:4006"
      - "40000-40100:40000-40100/udp"
      - "40000-40100:40000-40100/tcp"
```

**Test:**

```bash
docker-compose config
docker-compose up --build sfu-service
curl http://localhost:4006/api/v1/sfu/router-capabilities/test-room
```

`RTC_MIN_PORT` / `RTC_MAX_PORT` compose ke port range se **exactly match** hone chahiye.

---

## 5. Common Galtiyan (dhyan rakhna)

1. **`ANNOUNCED_IP` galat:** Connection ban hi nahi hoga. Local mein `127.0.0.1`, LAN test mein apne laptop ka IP, production mein public IP.
2. **UDP ports publish nahi kiye:** Docker mein `40000-40100/udp` zaroori hai.
3. **Range mismatch:** `.env` ka port range aur Docker ka range alag hoga to media flow nahi hoga.
4. **Consumer ko paused nahi banaya:** Pehle frames miss ho jate hain.
5. **Cleanup bhoolna:** Leave pe transports close nahi kiye to memory aur ports leak honge.
6. **Ek Router ko 2 baar banana:** `roomManager` mein Promise store isi ke liye hai, use mat badalna.
7. **Import style mix karna:** Poore project mein bina extension wale imports rakho.

---

## 6. Useful Commands

```bash
# Dev mode (auto-restart)
npm run dev

# Type check (koi output nahi = sab sahi)
npx tsc --noEmit

# Build + production run
npm run build && npm start

# Router capabilities test
curl http://localhost:4006/api/v1/sfu/router-capabilities/test-room

# Docker
docker-compose up --build sfu-service
docker-compose logs -f sfu-service
docker-compose down
```

---

## 7. Git Checkpoints

Har step ke baad commit karo:

```bash
git add .
git commit -m "phase-9: step 5 room manager + router capabilities"
```

Suggested commit messages:

- `phase-9: step 6 transports and produce api`
- `phase-9: step 7 consume and resume api`
- `phase-9: step 8 signaling integration`
- `phase-9: step 9 frontend sfu mode`
- `phase-9: hardening and cleanup`

---

## 8. Next Action

**Ab karna hai:** Step 6 shuru karo (`peerManager.ts` se), `POST /transports` endpoint banao, aur `iceParameters` / `dtlsParameters` wala response test karo.
go throguh this - [claude.ai/chat/2488fe4f-aff4-42c4-a573-acf962d752f1](https://claude.ai/chat/2488fe4f-aff4-42c4-a573-acf962d752f1)
