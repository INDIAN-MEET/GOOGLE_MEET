# chat-service

**Port:** 4005 | **Database:** MongoDB (`chat_db`)  
**Status:** ✅ Phase 8 Completed

Handles asynchronous chat message persistence and history retrieval for video call rooms. Messages sent during meetings are published by `signaling-service` over Redis Pub/Sub (`chat-message` channel) and persisted into MongoDB without blocking real-time WebSocket communication. Authenticated HTTP clients can fetch paginated message history via the API Gateway.

---

## Key Features

- **Async Message Persistence (Redis Subscriber):** Automatically subscribes to the Redis `chat-message` channel on startup. Parses and validates incoming JSON payloads and saves them to MongoDB (`chat_db.chatmessages`).
- **Paginated Chat History (`GET /api/v1/chat/:roomId/messages`):** Protected REST endpoint returning historical messages for a room (sorted oldest-first, configurable limit up to 200).
- **MongoDB Indexing:** Uses compound index `{ roomId: 1, createdAt: 1 }` for high-performance history queries.

---

## Routes

Internal mount: `app.use('/api/v1/chat', chatRoutes)`

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| GET | `/api/v1/chat/:roomId/messages` | ✅ JWT | Fetches historical messages for `roomId`. Query params: `limit` (default 50, max 200). |
| GET | `/health` | ❌ | Health check returning `{ status: "ok", service: "chat-service" }`. |

> **Gateway Path:** Client calls `GET /api/v1/chat/:roomId/messages` through the API Gateway (`:4000`), which verifies JWT authentication before forwarding.

---

## Data Model (Mongoose — MongoDB)

### `ChatMessage` Schema
```typescript
interface IChatMessage {
  roomId: string;      // Indexed; meeting room code or ID
  senderId: string;    // Sender's user ID
  senderName: string;  // Sender's display name or fallback
  text: string;        // Chat text content
  createdAt: Date;     // Auto-generated timestamp
}
```

---

## Redis Pub/Sub Payload Format

Channel: `chat-message`

```json
{
  "roomId": "abc-defg-hij",
  "senderId": "123e4567-e89b-12d3-a456-426614174000",
  "senderName": "Alice",
  "text": "Hello everyone!"
}
```

---

## Environment Variables

Source: `.env.docker`

| Variable | Example | Description |
|---|---|---|
| `PORT` | `4005` | Listening port |
| `MONGO_URI` | `mongodb://mongo:27017/chat_db` | MongoDB connection string |
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL |
| `JWT_ACCESS_SECRET` | `secret` | Shared secret for verifying JWT tokens |
| `NODE_ENV` | `development` | Environment mode |

---

## Running & Testing

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Manual Test via Curl
```bash
TOKEN="<your_jwt_access_token>"

curl -s "http://localhost:4000/api/v1/chat/abc-defg-hij/messages?limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```
