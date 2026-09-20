# user-service

**Port:** 4002 | **Database:** PostgreSQL (`user_db`)

Manages user profiles. On startup, subscribes to the Redis `user-created` channel and automatically creates a blank `Profile` row whenever auth-service registers a new user. Exposes two HTTP endpoints for reading and updating profiles.

---

## What it does

- Listens for `user-created { userId }` events from Redis and calls `prisma.profile.create({ data: { userId } })` to bootstrap a profile.
- Provides a GET endpoint to fetch the caller's profile by `userId` (from the JWT, verified locally).
- Provides a PATCH endpoint to update `displayName`, `avatarUrl`, and `preferences`.

---

## Routes

Internal mount: `app.use('/', profileRoutes)` — no version prefix.

| Method | Path | Auth required | What it does |
|---|---|---|---|
| GET   | `/me` | ✅ JWT | Returns the Profile row for `req.userId` |
| PATCH | `/me` | ✅ JWT | Updates `displayName`, `avatarUrl`, `preferences` for `req.userId` |
| GET   | `/health` | ❌ | Health check |

> **Gateway path:** Clients call `/api/users/me` → rewritten to `/me` (Gateway strips `/users`).

---

## Data model (Prisma — PostgreSQL)

### `Profile`
| Field | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `userId` | String | unique; matches auth-service user ID |
| `displayName` | String? | nullable |
| `avatarUrl` | String? | nullable |
| `preferences` | Json? | nullable; free-form JSON |
| `createdAt` | DateTime | auto |

---

## Redis pub/sub

**Subscribes** to channel `user-created` (subscriber started as a side-effect import in `src/config/redis.ts`, triggered by `app.ts` import).

Expected payload:
```json
{ "userId": "<uuid>" }
```

On message: creates a `Profile` with `{ userId }` (all other fields null).

---

## Environment variables

Source: `.env.docker`

| Variable | Example | Required |
|---|---|---|
| `PORT` | `4002` | ✅ |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/user_db` | ✅ |
| `JWT_ACCESS_SECRET` | `change_this_later...` | ✅ |
| `REDIS_URL` | `redis://redis:6379` | ✅ |
| `NODE_ENV` | `production` | ✅ |

> **Note:** `env.ts` also exports `JWT_REFRESH_SECRET` but user-service never issues or validates refresh tokens — it is read but unused.

---

## Run locally

```bash
npm install
npx prisma migrate deploy   # first time only
npm run dev   # tsx watch server.ts — :4002
```

## Test

```bash
TOKEN="<your accessToken>"

# Get profile
curl -s http://localhost:4002/me \
  -H "Authorization: Bearer $TOKEN" | jq

# Update profile
curl -s -X PATCH http://localhost:4002/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alice","avatarUrl":"https://example.com/avatar.png"}' | jq
```

> Via Gateway: use `http://localhost:4000/api/users/me` instead of `:4002/me`.
