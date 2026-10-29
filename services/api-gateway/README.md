# api-gateway

**Port:** 4000 | **Database:** None (Redis used for rate-limiting counters)

Reverse-proxy entry point and security perimeter for all HTTP traffic. Hardened in Phase 12 with tiered Redis rate limiting, proxy error trapping (502/504 sanitization), request correlation IDs (`x-request-id`), anti-spoofing header cleaning, body size limits, and liveness/readiness probes.

Clients never call backend services directly (except signaling-service, which is WebSocket and bypasses the Gateway entirely).

---

## What it does

- **Security & Perimeter:** Applies CORS with exposed headers, Helmet (`cross-origin` resource policy), and Pino HTTP logging to all incoming requests.
- **Request Tracing:** Generates or accepts a UUID `x-request-id`, echoing it back in responses and propagating it to downstream microservices.
- **Header Sanitization:** Strips incoming spoofed `x-user-id` headers on public and protected routes before gateway authentication.
- **Gateway Authentication:** Verifies Bearer JWTs locally (`gatewayAuth`), attaches `req.userId`, and forwards verified `x-user-id` downstream.
- **Tiered Rate Limiting:** Enforces Redis-backed sliding-window rate limiters with standardized draft-7 `RateLimit` and `Retry-After` headers.
- **Proxy Error Trapping:** Intercepts low-level upstream network failures (`ECONNREFUSED`, timeouts), returning sanitized 502/504 JSON responses without leaking internal service topology or stack traces. Increments `gateway_proxy_errors_total{target, status}`.
- **Observability & Metrics:** Exposes `GET /metrics` (protected by Bearer `METRICS_TOKEN`) mounted BEFORE rate limiters. Tracks duration histograms with low-cardinality prefix routing and increments `gateway_rate_limit_hits_total{limiter}` on 429s.
- **Liveness & Readiness Probes:** Provides un-logged, un-limited `/health` (process liveness) and `/ready` (Redis connectivity readiness).

---

## Rate Limit Tiers

| Tier | Endpoints | Window | Max Requests | Identification | Failure Strategy |
|---|---|---|---|---|---|
| **Global** | All HTTP routes | 1 minute | 300 | Client IP | Fail Open |
| **Auth** | `/api/auth/login`, `/signup` | 15 minutes | 10 (failed only) | Client IP | Fail Closed (503) |
| **Auth Refresh** | `/api/auth/refresh` | 15 minutes | 30 | Client IP | Fail Closed (503) |
| **Standard API** | `/api/v1/rooms/*`, `/api/users/*`, `/api/v1/chat/*`, `/api/v1/notifications/*`, `/api/auth/me` | 1 minute | 100 | User ID (falls back to IP) | Fail Open |
| **Heavy Download** | `/api/v1/recordings/:id/download` | 1 hour | 120 | User ID (falls back to IP) | Fail Open |

---

## Routes (proxy map)

Source: `src/routes/proxyRoutes.ts`

| Method | Client path (under `/api`) | `gatewayAuth`? | Rate Limit Tier | Forwards to |
|---|---|---|---|---|
| POST | `/auth/signup` | ❌ | Auth (10/15m) | `AUTH_SERVICE_URL/api/v1/auth/signup` |
| POST | `/auth/login` | ❌ | Auth (10/15m) | `AUTH_SERVICE_URL/api/v1/auth/login` |
| POST | `/auth/refresh` | ❌ | Refresh (30/15m) | `AUTH_SERVICE_URL/api/v1/auth/refresh` |
| POST | `/auth/logout` | ✅ | Standard (100/m) | `AUTH_SERVICE_URL/api/v1/auth/logout` |
| GET  | `/auth/me` | ✅ | Standard (100/m) | `AUTH_SERVICE_URL/api/v1/auth/me` |
| GET  | `/auth/turn-credentials` | ✅ | Standard (100/m) | `AUTH_SERVICE_URL/api/v1/auth/turn-credentials` |
| GET  | `/users/me` | ✅ | Standard (100/m) | `USER_SERVICE_URL/me` |
| PATCH | `/users/me` | ✅ | Standard (100/m) | `USER_SERVICE_URL/me` |
| POST | `/v1/rooms` | ✅ | Standard (100/m) | `ROOM_SERVICE_URL/v1/rooms` |
| GET  | `/v1/rooms/:code` | ✅ | Standard (100/m) | `ROOM_SERVICE_URL/v1/rooms/:code` |
| POST | `/v1/rooms/:code/join` | ✅ | Standard (100/m) | `ROOM_SERVICE_URL/v1/rooms/:code/join` |
| POST | `/v1/rooms/:code/leave` | ✅ | Standard (100/m) | `ROOM_SERVICE_URL/v1/rooms/:code/leave` |
| POST | `/v1/rooms/:code/end` | ✅ | Standard (100/m) | `ROOM_SERVICE_URL/v1/rooms/:code/end` |
| GET  | `/v1/chat/:roomId/messages` | ✅ | Standard (100/m) | `CHAT_SERVICE_URL/api/v1/chat/:roomId/messages` |
| POST | `/v1/recordings/start` | ✅ | Standard (100/m) | `RECORDING_SERVICE_URL/v1/recordings/start` |
| POST | `/v1/recordings/stop` | ✅ | Standard (100/m) | `RECORDING_SERVICE_URL/v1/recordings/stop` |
| GET  | `/v1/recordings/room/:roomId` | ✅ | Standard (100/m) | `RECORDING_SERVICE_URL/v1/recordings/room/:roomId` |
| GET  | `/v1/recordings/:recordingId` | ✅ | Standard (100/m) | `RECORDING_SERVICE_URL/v1/recordings/:recordingId` |
| GET  | `/v1/recordings/:recordingId/download` | ✅ | Download (120/h) | `RECORDING_SERVICE_URL/v1/recordings/:recordingId/download` |
| POST | `/v1/notifications/invites` | ✅ | Standard (100/m) | `NOTIFICATION_SERVICE_URL/v1/notifications/invites` |
| GET  | `/health` | ❌ | None (Direct) | Local Gateway process liveness (`200 OK`) |
| GET  | `/ready` | ❌ | None (Direct) | Local Gateway + Redis readiness check (`200 OK` or `503`) |

---

## Environment variables

Source: `.env.docker` and `.env.example`

| Variable | Example | Required | Purpose |
|---|---|---|---|
| `PORT` | `4000` | ✅ | Gateway listening port |
| `NODE_ENV` | `production` | ✅ | Toggles stack trace hiding in errors |
| `FRONTEND_URL` | `http://localhost:3000` | ✅ | CORS allowed origin |
| `JWT_ACCESS_SECRET` | `secret` | ✅ | Local JWT verification |
| `AUTH_SERVICE_URL` | `http://auth-service:4001` | ✅ | Downstream Auth service |
| `USER_SERVICE_URL` | `http://user-service:4002` | ✅ | Downstream User service |
| `ROOM_SERVICE_URL` | `http://room-service:4003` | ✅ | Downstream Room service |
| `CHAT_SERVICE_URL` | `http://chat-service:4005` | ✅ | Downstream Chat service |
| `RECORDING_SERVICE_URL` | `http://recording-service:4007` | ✅ | Downstream Recording service |
| `NOTIFICATION_SERVICE_URL` | `http://notification-service:4008` | ✅ | Downstream Notification service |
| `REDIS_URL` | `redis://redis:6379` | ✅ | Shared Redis for rate limiting |
| `TRUST_PROXY` | `0` | ✅ | Number of upstream reverse proxies |
| `BODY_LIMIT` | `100kb` | ✅ | Maximum incoming JSON body size |

---

## Local Development & Testing

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start in development mode with hot reload
npm run dev

# Run automated E2E test suite (requires docker stack running)
node scripts/e2e-gateway.mjs
```
