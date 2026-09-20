# auth-service

**Port:** 4001 | **Database:** PostgreSQL (`auth_db`)

Handles user identity: registration, login, token issuance (JWT access + refresh), token refresh via HTTP-only cookie, logout, and TURN credential generation for WebRTC. On every successful signup, publishes a `user-created` event to Redis so user-service can auto-create a profile.

---

## What it does

- Creates users with bcrypt-hashed passwords and issues JWTs on login.
- Issues short-lived access tokens (verified locally by all services) and stores long-lived refresh tokens in the database.
- Generates coturn TURN credentials using HMAC-SHA1 (time-limited, coturn verifies independently).
- Exposes an `/internal/verify-token` endpoint (not currently called by any service, available for future use).

---

## Routes

Internal mount: `app.use('/api/v1', v1Routes)` → `router.use('/auth', authRoutes)` + `router.use('/internal', internalRoutes)`

| Method | Path | Auth required | What it does |
|---|---|---|---|
| POST | `/api/v1/auth/signup` | ❌ | Creates user, hashes password, publishes `user-created` to Redis, returns `{ userId }` |
| POST | `/api/v1/auth/login` | ❌ | Verifies credentials, issues access + refresh tokens, sets `refreshToken` in HTTP-only cookie |
| POST | `/api/v1/auth/refresh` | ❌ (cookie) | Validates refresh token from cookie against DB, issues new access token |
| GET  | `/api/v1/auth/me` | ✅ JWT | Returns `{ userId: req.userId }` — **not** a full user object |
| GET  | `/api/v1/auth/turn-credentials` | ✅ JWT | Returns `iceServers` array with STUN and TURN credentials (10 min TTL) |
| POST | `/api/v1/logout` | ✅ JWT (via Gateway) | TODO: check if logoutController deletes the refresh token from DB |
| GET  | `/api/v1/internal/verify-token` | Bearer token | Verifies JWT, returns `{ valid: bool, userId? }` — not called by other services currently |

> **Note on logout path:** In `v1/index.ts`, logout is mounted as `router.post('/logout', logoutController)`, making its full path `/api/v1/logout` (not `/api/v1/auth/logout`). The Gateway rewrite maps `/auth/logout` → `/api/v1/auth/logout`. This is a **mismatch**: the Gateway forwards to `/api/v1/auth/logout` but the service only handles `/api/v1/logout`. Test this endpoint to confirm behavior.

---

## Data model (Prisma — PostgreSQL)

### `User`
| Field | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `email` | String | unique |
| `passwordHash` | String | bcrypt |
| `createdAt` | DateTime | auto |

### `RefreshToken`
| Field | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `userId` | String | FK → User |
| `token` | String | raw refresh token |
| `expireAt` | DateTime | 7 days from login |

---

## Redis pub/sub

**Publishes** to channel `user-created`:
```json
{ "userId": "<uuid>" }
```
Published inside `signupController` immediately after the user row is created. Consumed by user-service to auto-create a Profile.

---

## TURN credential generation

Algorithm (coturn REST API auth scheme):
1. `expiry = floor(Date.now()/1000) + 600`
2. `username = "${expiry}:${userId}"`
3. `credential = HMAC-SHA1(TURN_SECRET, username).digest('base64')`

coturn recomputes this on its side; no credential is stored.

---

## Environment variables

Source: `.env.docker`

| Variable | Example | Required |
|---|---|---|
| `PORT` | `4001` | ✅ |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/auth_db` | ✅ |
| `JWT_ACCESS_SECRET` | `change_this_later...` | ✅ |
| `JWT_REFRESH_SECRET` | `change_this_too` | ✅ |
| `REDIS_URL` | `redis://redis:6379` | ✅ |
| `TURN_SECRET` | `cb914f8e...` | ✅ |
| `TURN_REALM` | `videomeet.local` | ✅ |
| `NODE_ENV` | `production` | ✅ |

---

## Run locally

```bash
npm install
npx prisma migrate deploy   # first time only
npm run dev   # tsx watch server.ts — :4001
```

## Test

```bash
# Signup
curl -s -X POST http://localhost:4001/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq

# Login
curl -s -X POST http://localhost:4001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq

# TURN credentials (requires token from login)
curl -s http://localhost:4001/api/v1/auth/turn-credentials \
  -H "Authorization: Bearer <accessToken>" | jq
```
