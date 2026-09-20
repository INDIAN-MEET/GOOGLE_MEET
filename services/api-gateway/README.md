# api-gateway

**Port:** 4000 | **Database:** None

Reverse-proxy entry point for all HTTP traffic. Validates JWTs locally before forwarding requests to downstream services. Clients never call backend services directly (except signaling-service, which is WebSocket and bypasses the Gateway entirely).

---

## What it does

- Applies CORS, Helmet, and Pino HTTP logging to all incoming requests.
- For protected routes, runs `gatewayAuth` middleware: verifies the Bearer JWT locally with `JWT_ACCESS_SECRET`, attaches `req.userId`, and forwards an `x-user-id` header downstream.
- Proxies requests to auth, user, room, and chat services using `http-proxy-middleware` with per-service path rewrites.

---

## Routes (proxy map)

Source: `src/routes/proxyRoutes.ts`

| Method | Client path (under `/api`) | `gatewayAuth`? | Forwards to |
|---|---|---|---|
| POST | `/auth/signup` | ❌ | `AUTH_SERVICE_URL/api/v1/auth/signup` |
| POST | `/auth/login` | ❌ | `AUTH_SERVICE_URL/api/v1/auth/login` |
| POST | `/auth/refresh` | ❌ | `AUTH_SERVICE_URL/api/v1/auth/refresh` |
| POST | `/auth/logout` | ✅ | `AUTH_SERVICE_URL/api/v1/auth/logout` |
| GET  | `/auth/me` | ✅ | `AUTH_SERVICE_URL/api/v1/auth/me` |
| GET  | `/auth/turn-credentials` | ✅ | `AUTH_SERVICE_URL/api/v1/auth/turn-credentials` |
| GET  | `/users/me` | ✅ | `USER_SERVICE_URL/me` |
| PATCH | `/users/me` | ✅ | `USER_SERVICE_URL/me` |
| POST | `/v1/rooms` | ✅ | `ROOM_SERVICE_URL/v1/rooms` |
| GET  | `/v1/rooms/:code` | ✅ | `ROOM_SERVICE_URL/v1/rooms/:code` |
| POST | `/v1/rooms/:code/join` | ✅ | `ROOM_SERVICE_URL/v1/rooms/:code/join` |
| POST | `/v1/rooms/:code/leave` | ✅ | `ROOM_SERVICE_URL/v1/rooms/:code/leave` |
| POST | `/v1/rooms/:code/end` | ✅ | `ROOM_SERVICE_URL/v1/rooms/:code/end` |
| GET  | `/chat/:roomId/messages` | ✅ | `CHAT_SERVICE_URL/api/v1/chat/:roomId/messages` |
| GET  | `/health` | ❌ | (local, no proxy) |

---

## Data model

None — this service has no database.

---

## Redis pub/sub

None — the Gateway does not interact with Redis.

---

## Environment variables

Source: `.env.docker`

| Variable | Example | Required |
|---|---|---|
| `PORT` | `4000` | ✅ |
| `AUTH_SERVICE_URL` | `http://auth-service:4001` | ✅ |
| `USER_SERVICE_URL` | `http://user-service:4002` | ✅ |
| `ROOM_SERVICE_URL` | `http://room-service:4003` | ✅ |
| `CHAT_SERVICE_URL` | `http://chat-service:4005` | ✅ |
| `FRONTEND_URL` | `http://localhost:3000` | ✅ (CORS origin) |
| `JWT_ACCESS_SECRET` | `change_this_later...` | ✅ |
| `NODE_ENV` | `development` | ✅ |

> **Note:** `​.env.example` is missing `JWT_ACCESS_SECRET` and `CHAT_SERVICE_URL`. Use `.env.docker` as the complete reference.

---

## Run locally

```bash
npm install
npm run dev   # tsx watch server.ts — :4000
```

## Test

```bash
# Health check
curl http://localhost:4000/health

# Proxied (no auth required)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Proxied (auth required)
curl http://localhost:4000/api/users/me \
  -H "Authorization: Bearer <accessToken>"
```
