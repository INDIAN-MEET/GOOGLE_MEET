# chat-service

**Port:** 4005 | **Database:** MongoDB (`chat_db`)

Persists chat messages for video call rooms. Does not accept chat messages over HTTP — messages are written exclusively via a Redis subscriber that listens for `chat-message` events (published by signaling-service or other producers). Exposes one HTTP endpoint to retrieve historical messages for a room.

---

## What it does

- On startup, connects to MongoDB and starts a Redis subscriber on the `chat-message` channel.
- Each received message is validated and persisted to MongoDB as a `ChatMessage` document.
- A single HTTP GET endpoint allows authenticated clients to retrieve paginated message history for a room (oldest-first, max 200 per request).

---

## Routes

Internal mount: `app.use('/api/v1/chat', chatRoutes)`

| Method | Path | Auth required | What it does |
|---|---|---|---|
| GET | `/api/v1/chat/:roomId/messages` | ✅ JWT | Returns messages for `roomId`, sorted oldest-first; `?limit=N` (default 50, max 200) |
| GET | `/health` | ❌ | Health check |

> **Gateway path:** Clients call `GET /api/chat/:roomId/messages` → rewritten to `GET /api/v1/chat/:roomId/messages`.

---

## Data model (Mongoose — MongoDB)

### `ChatMessage`
| Field | Type | Required | Notes |
|---|---|---|---|
| `roomId` | String | ✅ | Indexed; matches room code or room ID used by signaling-service |
| `senderId` | String | ✅ | User ID of the sender |
| `senderName` | String | ✅ | Display name at time of send |
| `text` | String | ✅ | Max 2000 characters |
| `createdAt` | Date | auto | Default `Date.now` |

Compound index on `{ roomId: 1, createdAt: 1 }` for efficient history reads.

---

## Redis pub/sub

**Subscribes** to channel `chat-message` (using the `redis` npm client, separate connection from the ioredis instance).

Expected payload:
```json
{
  "roomId": "abc-defg-hij",
  "senderId": "<uuid>",
  "senderName": "Alice",
  "text": "Hello!"
}
```

Validation: drops messages missing `roomId`, `senderId`, or `text`. Errors are logged and swallowed — a bad message never crashes the subscriber loop.

> **Note on publisher:** The `chat-message` channel is declared as published by `signaling-service` in the architecture docs, but the current `signaling-service` handlers (`relay.ts`, `joinRoom.ts`, `leaveRoom.ts`) do not contain a `redis.publish('chat-message', ...)` call. The subscriber is ready; the publisher is a TODO in signaling-service.

---

## Environment variables

Source: `.env.docker`

| Variable | Example | Required |
|---|---|---|
| `PORT` | `4005` | ✅ |
| `MONGO_URI` | `mongodb://mongo:27017/chat_db` | ✅ |
| `REDIS_URL` | `redis://redis:6379` | ✅ |
| `JWT_ACCESS_SECRET` | `change_this_later...` | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `GATEWAY_SECRET` | — | ❌ Unused (leftover) |
| `AUTH_SERVICE_URL` | — | ❌ Unused (leftover) |
| `JWT_REFRESH_SECRET` | — | ❌ Unused (leftover) |

---

## Run locally

```bash
npm install
npm run dev   # tsx watch server.ts — :4005
```

## Test

```bash
TOKEN="<your accessToken>"
ROOM_ID="abc-defg-hij"

# Get chat history (likely empty unless chat-message was published to Redis)
curl -s "http://localhost:4005/api/v1/chat/$ROOM_ID/messages?limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq

# Manually publish a test message to Redis to trigger persistence:
# redis-cli PUBLISH chat-message '{"roomId":"abc-defg-hij","senderId":"user-123","senderName":"Alice","text":"Hello"}'
```

> Via Gateway: `http://localhost:4000/api/chat/$ROOM_ID/messages?limit=20`
