# room-service

**Port:** 4003 | **Database:** PostgreSQL (`room_db`)

Manages the full lifecycle of video call rooms: creation, retrieval, joining, leaving, and ending. All routes require a valid JWT access token (verified locally via `authGuard`). Rooms are identified by a short, human-shareable code (e.g., `abc-defg-hij`).

---

## What it does

- Creates rooms with a generated code and assigns a `hostUserId`.
- Tracks participants with `RoomParticipant` records (join/leave timestamps).
- Only the host can end a room (`endRoomController`).
- Signaling-service calls this service directly (HTTP GET `/v1/rooms/:code`) to verify a room is active before allowing a socket to join.

---

## Routes

Internal mount: `app.use('/v1', roomRoutes)` — all routes require JWT (`router.use(authGuard)` at the top of the router).

| Method | Path | Auth required | What it does |
|---|---|---|---|
| POST | `/v1/rooms` | ✅ JWT | Creates a room; body: `{ title?: string }`; returns `{ room }` |
| GET  | `/v1/rooms/:code` | ✅ JWT | Fetches room by code, including active participants |
| POST | `/v1/rooms/:code/join` | ✅ JWT | Adds the caller as a participant (`joinedAt` set, `leftAt` null) |
| POST | `/v1/rooms/:code/leave` | ✅ JWT | Sets `leftAt` timestamp on the caller's participant record |
| POST | `/v1/rooms/:code/end` | ✅ JWT (host only) | Marks room `isActive=false`, sets `endedAt`; only host may call this |
| GET  | `/health` | ❌ | Health check |

> **Gateway path:** Clients must call `/api/v1/rooms/...` (the `/v1` prefix is **not** hidden by the Gateway — the rewrite is a no-op). This is the only service where `/v1` appears in the client-facing URL.

---

## Data model (Prisma — PostgreSQL)

### `Room`
| Field | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `code` | String | unique; shareable room code |
| `hostUserId` | String | ID of the user who created the room |
| `title` | String? | nullable |
| `isActive` | Boolean | default `true`; set to `false` on end |
| `createdAt` | DateTime | auto |
| `endedAt` | DateTime? | set when room is ended |

### `RoomParticipant`
| Field | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `roomId` | String | FK → Room (cascade delete) |
| `userId` | String | participant's user ID |
| `joinedAt` | DateTime | auto |
| `leftAt` | DateTime? | null until leave is called |

---

## Redis pub/sub

None — room-service does not interact with Redis.

---

## Environment variables

Source: `.env.example` / `.env.docker`

| Variable | Example | Required |
|---|---|---|
| `PORT` | `4003` | ✅ |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/room_db` | ✅ |
| `JWT_ACCESS_SECRET` | `replace_with_same_secret_as_auth_service` | ✅ |
| `NODE_ENV` | `development` | ✅ |

---

## Run locally

```bash
npm install
npx prisma migrate deploy   # first time only
npm run dev   # tsx watch server.ts — :4003
```

## Test

```bash
TOKEN="<your accessToken>"

# Create room
curl -s -X POST http://localhost:4003/v1/rooms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"My Room"}' | jq

# Get room by code
curl -s http://localhost:4003/v1/rooms/abc-defg-hij \
  -H "Authorization: Bearer $TOKEN" | jq

# Join room
curl -s -X POST http://localhost:4003/v1/rooms/abc-defg-hij/join \
  -H "Authorization: Bearer $TOKEN" | jq

# Leave room
curl -s -X POST http://localhost:4003/v1/rooms/abc-defg-hij/leave \
  -H "Authorization: Bearer $TOKEN" | jq

# End room (host only)
curl -s -X POST http://localhost:4003/v1/rooms/abc-defg-hij/end \
  -H "Authorization: Bearer $TOKEN" | jq
```

> Via Gateway: use `http://localhost:4000/api/v1/rooms/...`.
