# signaling-service

**Port:** 4004 | **Database:** None (Redis for live presence only)

WebRTC signaling server built on Socket.io. Clients connect directly via WebSocket (this service is **not** proxied through the API Gateway). Authenticates connections via JWT on the WebSocket handshake, verifies the room is active by calling room-service over HTTP, then relays WebRTC offer/answer/ICE-candidate messages between peers.

---

## What it does

- Authenticates the WebSocket connection by verifying the JWT locally (`socketAuth` middleware).
- On `join-room`, calls room-service (`GET /v1/rooms/:code`) to verify the room is active, then adds the socket to a Redis set (`room:<code>:members`) and to a Socket.io room.
- Relays `offer`, `answer`, and `ice-candidate` events between peers by forwarding the payload to the target socket ID.
- On `leave-room` or `disconnect`, removes the socket from the Redis members set and emits `peer-left` to the room.

---

## Socket.io Events

### Client → Server

| Event | Payload | What happens |
|---|---|---|
| `join-room` | `{ roomCode: string }` | Verifies room via room-service; adds to Redis set + Socket.io room; emits `joined` back and `peer-joined` to existing peers |
| `offer` | `{ targetSocketId: string, sdp: any }` | Forwarded to `targetSocketId` with `fromSocketId` added |
| `answer` | `{ targetSocketId: string, sdp: any }` | Forwarded to `targetSocketId` with `fromSocketId` added |
| `ice-candidate` | `{ targetSocketId: string, candidate: any }` | Forwarded to `targetSocketId` with `fromSocketId` added |
| `leave-room` | — | Removes from Redis set; emits `peer-left` to room |
| `disconnect` | — | Same cleanup as `leave-room` |

### Server → Client

| Event | Payload | When |
|---|---|---|
| `joined` | `{ existingMembers: string[] }` | After successful `join-room`; members are socket IDs |
| `peer-joined` | `{ socketId: string, userId: string }` | Broadcast to existing room members when a new peer joins |
| `peer-left` | `{ socketId: string }` | Broadcast when a peer leaves or disconnects |
| `join-error` | `string` (error message) | If room not found or inactive |
| `offer` | `{ fromSocketId: string, ...rest }` | Relayed offer from another peer |
| `answer` | `{ fromSocketId: string, ...rest }` | Relayed answer from another peer |
| `ice-candidate` | `{ fromSocketId: string, ...rest }` | Relayed ICE candidate from another peer |

---

## Authentication

`socketAuth` middleware (runs on every connection before any handler):
```
token = socket.handshake.auth.token || socket.handshake.query.token
jwt.verify(token, JWT_ACCESS_SECRET)
→ socket.data.userId, socket.data.token
```

---

## Redis usage (presence only)

| Key pattern | Type | Operation | When |
|---|---|---|---|
| `room:<code>:members` | Set | `SADD <socketId>` | On `join-room` |
| `room:<code>:members` | Set | `SMEMBERS` | On `join-room` (to get existing members) |
| `room:<code>:members` | Set | `SREM <socketId>` | On `leave-room` / disconnect |

> This Redis data is ephemeral — it tracks live socket IDs, not persistent data. If the service restarts, the sets are effectively stale until members reconnect.

---

## Chat message publishing (Redis pub/sub)

> **TODO:** `signaling-service` uses `ioredis` for the presence sets above, but the `chat-message` channel publish (consumed by chat-service) is not implemented in the current `signaling-service` handlers. The `relay.ts` handlers only forward WebRTC signaling. If text chat is sent via WebSocket, the publisher for `chat-message` needs to be added here.

---

## Environment variables

Source: `.env.example` / `.env.docker`

| Variable | Example | Required |
|---|---|---|
| `PORT` | `4004` | ✅ |
| `JWT_ACCESS_SECRET` | `(same as auth-service)` | ✅ |
| `REDIS_URL` | `redis://localhost:6379` | ✅ |
| `ROOM_SERVICE_URL` | `http://localhost:4003` | ✅ |
| `NODE_ENV` | `development` | ✅ |

---

## Run locally

```bash
npm install
npm run dev   # tsx watch server.ts — :4004
```

## Test

```js
// Browser console or Node.js client
import { io } from 'socket.io-client';

const socket = io('http://localhost:4004', {
  auth: { token: '<accessToken>' }
});

socket.on('connect', () => {
  socket.emit('join-room', { roomCode: 'abc-defg-hij' });
});

socket.on('joined', ({ existingMembers }) => {
  console.log('Joined room, existing members:', existingMembers);
});

socket.on('peer-joined', ({ socketId, userId }) => {
  console.log('New peer:', socketId, userId);
  // Begin WebRTC negotiation: create offer → send 'offer' event
});
```
