
# Signaling Service

**Port:** 4004
**Database:** none (stateless HTTP/WS layer) — uses **Redis** for live, in-memory presence only
**Protocol:** WebSocket (Socket.io), not REST

## What this service does

- Lets two or more browsers already in the *same room* find each other and exchange
  WebRTC connection info (`offer`, `answer`, `ice-candidate`) in real time
- Verifies the JWT on every socket connection, locally — same pattern as
  Room/User Service's copied `authGuard`, just adapted for a socket handshake
  instead of an Express request
- Confirms the room is real and active by calling **Room Service** over HTTP
  before letting a socket join — this is the one real service-to-service
  network call in this service
- Tracks *who is currently connected* to which room using a Redis **set**
  (`room:{roomId}:members`) — this is live presence, separate from Room
  Service's `RoomParticipant` table (which tracks join/leave history, not
  live sockets)
- Does **not** touch video/audio itself. It only relays small JSON messages
  between browsers so they can set up a **direct peer-to-peer** connection.
  Once that connection is up, video/audio never passes through this service.

## Talks to

- **Room Service** (`GET /rooms/:code`) — one HTTP call per `join-room` event,
  to confirm the room exists and is active
- **Redis** — presence sets only (`SADD`/`SREM`/`SMEMBERS` on
  `room:{roomId}:members`); no Pub/Sub in this phase
- **Browsers**, directly, over WebSocket — this is the part that's different
  from every other service so far, which only spoke plain REST

## Why this service exists at all

Two browsers can't just "find" each other on the internet — WebRTC needs a
third party to introduce them first (exchange IP/port candidates and media
capabilities), then gets out of the way. That introduction step is called
**signaling**, and it's this service's entire job. Nothing here is
WebRTC-specific magic; it's a plain relay of JSON messages over a
socket that happens to carry `offer`/`answer`/`ice-candidate` payloads.

## Events (not REST routes)

| Direction         | Event             | Payload                           | What happens                                                               |
| ----------------- | ----------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Client → Server  | `join-room`     | `{ roomCode }`                  | Validates room via Room Service, adds socket to Redis set, notifies others |
| Server → Clients | `peer-joined`   | `{ socketId, userId }`          | Sent to existing members when someone new joins                            |
| Client → Server  | `offer`         | `{ targetSocketId, sdp }`       | Relayed untouched to the target socket                                     |
| Client → Server  | `answer`        | `{ targetSocketId, sdp }`       | Relayed untouched to the target socket                                     |
| Client → Server  | `ice-candidate` | `{ targetSocketId, candidate }` | Relayed untouched to the target socket                                     |
| Client → Server  | `leave-room`    | `{ roomCode }`                  | Removes socket from Redis set, notifies remaining members                  |
| Server → Clients | `peer-left`     | `{ socketId }`                  | Sent when a member disconnects or leaves                                   |
| (internal)        | `disconnect`    | —                                | Same cleanup as`leave-room`, for ungraceful exits (tab closed, etc.)     |

## Running with Docker

1. Make sure `.env.docker` is filled in with real values (not committed to git).
2. From the project root, run:
   ```bash
   docker compose up --build
   ```
3. The service will be available at `ws://localhost:4004` (Socket.io endpoint,
   not a browsable HTTP route — use a Socket.io client to connect).

To stop:

```bash
docker compose down
```

## Environment Variables

See `.env.example` for the full list. Required variables:

- `PORT` — port the service runs on (default: 4004)
- `REDIS_URL` — Redis connection string (presence sets)
- `JWT_ACCESS_SECRET` — must match Auth Service's exactly, used to verify
  tokens locally on socket handshake
- `ROOM_SERVICE_URL` — base URL for Room Service (e.g.
  `http://room-service:4003` inside Docker, `http://localhost:4003` locally)
- `NODE_ENV` — `development` | `production`
