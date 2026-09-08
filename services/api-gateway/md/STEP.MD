# API Gateway — Detailed Step-by-Step Build (Why / How / Code)

> **Status check:** Auth ✅, User ✅, Room ✅, Signaling ✅ — all four backend services are built, tested, and Dockerized. This is genuinely the right moment for the Gateway: it now has four real backends to unify, not one.
>
> **Format:** every step below follows **Why → How → Code**. Read the Why before touching the How — skipping it is how you end up copy-pasting a pattern without understanding when it stops applying.

---

## Table of Contents

- [Step 0 — Confirm What Each Service Actually Exposes](#step-0--confirm-what-each-service-actually-exposes)
- [Step 1 — Branch + Folder Structure](#step-1--branch--folder-structure)
- [Step 2 — package.json + Dependencies](#step-2--packagejson--dependencies)
- [Step 3 — Environment Files](#step-3--environment-files)
- [Step 4 — Copy Shared Utils (logger, AppError, errorHandler)](#step-4--copy-shared-utils-logger-apperror-errorhandler)
- [Step 5 — src/config/env.ts](#step-5--srcconfigenvts)
- [Step 6 — src/routes/proxyRoutes.ts](#step-6--srcroutesproxyroutests)
- [Step 7 — src/app.ts](#step-7--srcappts)
- [Step 8 — server.ts](#step-8--serverts)
- [Step 9 — Local Test (Before Docker)](#step-9--local-test-before-docker)
- [Step 10 — Dockerfile + .dockerignore](#step-10--dockerfile--dockerignore)
- [Step 11 — docker-compose.yml Entry](#step-11--docker-composeyml-entry)
- [Step 12 — Full Docker Test](#step-12--full-docker-test)
- [Final Folder Structure](#final-folder-structure)
- [Status Checklist](#status-checklist)

---

## Step 0 — Confirm What Each Service Actually Exposes

**Why:** a gateway can only proxy correctly if you know each backend's *real* route shape. Guessing this leads to `404`s that look like gateway bugs but are actually just wrong `pathRewrite` rules. Based on your actual codebase:

| Service                      | Real internal routes                                                                                       | Notes                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `auth-service` (4001)      | `/api/v1/auth/signup`, `/login`, `/refresh`, `/logout`, `/me`; `/api/v1/internal/verify-token` | Versioned — your`v1/index.ts` wraps everything                                        |
| `user-service` (4002)      | `/me` (GET/PATCH)                                                                                        | Flat, no version prefix, mounted directly in`app.ts`                                   |
| `room-service` (4003)      | `/rooms`, `/rooms/:code`, `/rooms/:code/join`, `/leave`, `/end`                                  | Flat, no version prefix                                                                  |
| `signaling-service` (4004) | WebSocket only — no REST routes worth proxying                                                            | **Not proxied through the Gateway at all** — the frontend connects to it directly |

**How:** this table is the source of truth for Step 6's `pathRewrite` rules — nothing to run here, just keep this open while writing the proxy config.

---

## Step 1 — Branch + Folder Structure

**Why:** same convention as every other service in this repo — a dedicated branch keeps `main` stable, and the folder shape mirrors the others so nothing feels unfamiliar when you come back to it later.

**How:**

```powershell
cd C:\Users\swaru\OneDrive\Desktop\PROJECT\GOOGLE_MEET
git checkout main
git checkout -b phase-1-api-gateway
cd services\api-gateway
mkdir src, src\config, src\routes, src\utils, src\middleware
```

**Code:** (nothing to write yet — just the empty skeleton)

```
api-gateway/
├── src/
│   ├── config/
│   ├── routes/
│   ├── utils/
│   ├── middleware/
│   └── app.ts
├── server.ts
├── package.json, tsconfig.json
```

---

## Step 2 — package.json + Dependencies

**Why:** the Gateway needs exactly three things it doesn't get from Express alone: a proxying library, CORS handling (since the frontend will be on a different port), and security headers (`helmet`). It needs **no** database driver, **no** Prisma, **no** `bcrypt`/`jsonwebtoken` — it never touches user data or verifies tokens itself, it just forwards requests.

**How:**

```powershell
npm init -y
npm install express http-proxy-middleware cors helmet dotenv pino pino-http
npm install --save-dev typescript tsx @types/node @types/express @types/cors pino-pretty
```

**Code:** add to `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

---

## Step 3 — Environment Files

**Why:** you've already hit the `localhost` vs. Docker-service-name mismatch twice (Phase 3, Phase 4). The Gateway is the highest-risk place for that mistake to repeat, because it talks to **four** different targets at once instead of one. Keeping `.env` (local) and `.env.docker` (container) as clearly separate files — rather than one file you mentally "remember to change" — is what actually prevents the bug this time.

**How:** create three files in the `api-gateway` root.

**Code — `.env`** (local dev, services running via `npm run dev` on your machine):

```
PORT=4000
AUTH_SERVICE_URL=http://localhost:4001
USER_SERVICE_URL=http://localhost:4002
ROOM_SERVICE_URL=http://localhost:4003
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

**Code — `.env.docker`** (container, same-name resolution via Docker's internal network):

```
PORT=4000
AUTH_SERVICE_URL=http://auth-service:4001
USER_SERVICE_URL=http://user-service:4002
ROOM_SERVICE_URL=http://room-service:4003
FRONTEND_URL=http://localhost:3000
NODE_ENV=production
```

**Code — `.env.example`** (committed, no real values needed since none of this is secret — but keep the pattern consistent with every other service):

```
PORT=4000
AUTH_SERVICE_URL=http://localhost:4001
USER_SERVICE_URL=http://localhost:4002
ROOM_SERVICE_URL=http://localhost:4003
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

---

## Step 4 — Copy Shared Utils (logger, AppError, errorHandler)

**Why:** same "copy, don't import across services" rule you've followed for auth/user/room/signaling. The Gateway needs structured logging and consistent error shape just like every other service — no service gets to be "the simple one that skips this."

**How:**

```powershell
Copy-Item ..\auth-service\src\utils\logger.ts src\utils\logger.ts
Copy-Item ..\auth-service\src\utils\AppError.ts src\utils\AppError.ts
Copy-Item ..\auth-service\src\middleware\errorHandler.ts src\middleware\errorHandler.ts
```

**Code:** no changes needed to these files — but note `logger.ts` imports `NODE_ENV` from `../config/env.js`, so Step 5 must exist before this compiles.

---

## Step 5 — `src/config/env.ts`

**Why:** every other service centralizes its environment variables into one typed export file instead of scattering `process.env.X` calls everywhere — this is the one place that would need updating if an env var name ever changed.

**How:** create the file.

**Code:**

```typescript
import 'dotenv/config';

export const PORT: string = process.env.PORT || '4000';
export const AUTH_SERVICE_URL: string = process.env.AUTH_SERVICE_URL as string;
export const USER_SERVICE_URL: string = process.env.USER_SERVICE_URL as string;
export const ROOM_SERVICE_URL: string = process.env.ROOM_SERVICE_URL as string;
export const FRONTEND_URL: string = process.env.FRONTEND_URL as string;
export const NODE_ENV: string = process.env.NODE_ENV as string;
```

---

## Step 6 — `src/routes/proxyRoutes.ts`

**Why:** this is the actual core of the Gateway — one proxy rule per backend service. The `pathRewrite` option matters because your three services don't share one URL shape (Auth is versioned under `/api/v1/auth`, User and Room are flat) — the Gateway's job is to hide that inconsistency and present **one clean shape** to the frontend: `/api/auth/*`, `/api/users/*`, `/api/rooms/*`, regardless of what each backend happens to do internally.

**How:** create the file, one `router.use()` block per service, using the table from Step 0.

**Code:**

```typescript
import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AUTH_SERVICE_URL, USER_SERVICE_URL, ROOM_SERVICE_URL } from '../config/env.js';

const router = Router();

// Client calls: /api/auth/signup  →  Auth Service actually has: /api/v1/auth/signup
router.use('/auth', createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/auth': '/api/v1/auth' },
}));

// Client calls: /api/users/me  →  User Service actually has: /me
router.use('/users', createProxyMiddleware({
  target: USER_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/users': '' },
}));

// Client calls: /api/rooms  →  Room Service actually has: /rooms (same shape, no rewrite needed)
router.use('/rooms', createProxyMiddleware({
  target: ROOM_SERVICE_URL,
  changeOrigin: true,
}));

export default router;
```

**Why `changeOrigin: true` on every rule:** without it, the proxied request keeps the original `Host` header (e.g. `localhost:4000`) when it reaches the target service. Some backends (and CORS-sensitive setups) reject or misroute requests where the `Host` header doesn't match the server they're actually running on. Setting `changeOrigin: true` rewrites the `Host` header to match the target — this is normal, expected behavior for any reverse proxy, not a workaround.

**Why `signaling-service` has no rule here:** it's WebSocket-only. `http-proxy-middleware` *can* proxy WebSocket upgrades, but it adds real complexity (upgrade event handling, sticky sessions later) for a service the frontend is already designed to talk to directly. Per the architecture doc, this is the one deliberate exception — Signaling is public-facing on its own port, bypassing the Gateway entirely.

---

## Step 7 — `src/	`

**Why:** two details here are easy to get wrong and both would silently break proxying if missed — they're called out explicitly rather than left implicit.

**How:** create the file.

**Code:**

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import proxyRoutes from './routes/proxyRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { FRONTEND_URL } from './config/env.js';
import logger from './utils/logger.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(pinoHttp({ logger }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

app.use('/api', proxyRoutes);

app.use(errorHandler); // always last

export default app;
```

**Why there's deliberately no `app.use(express.json())` here:** in every other service, this line comes early. In the Gateway, adding it **before** the proxy would actually break `http-proxy-middleware` — `express.json()` reads and consumes the incoming request body stream to parse it, but the proxy needs that *same raw stream* to forward untouched to the target service. If `express.json()` runs first, the proxy has nothing left to send, and the target service receives an empty body. The Gateway forwards bodies as-is; each backend service parses its own JSON, exactly as it already does.

**Why `credentials: true` in the `cors` config:** your Login flow sets an `httpOnly` refresh-token cookie (Auth Service, Phase 2). Browsers only send/accept cookies on cross-origin requests when the response explicitly allows credentials — once the frontend runs on `localhost:3000` and the Gateway on `localhost:4000`, that's a cross-origin request by the browser's definition, even though both are "localhost." Without this flag, the refresh-token cookie silently stops working the moment a real frontend enters the picture.

---

## Step 8 — `server.ts`

**Why:** same minimal pattern as every other service's entry point — import the app, listen, log that it's up.

**How:** create at the project root (not inside `src/`).

**Code:**

```typescript
import app from './src/app.js';
import { PORT } from './src/config/env.js';
import logger from './src/utils/logger.js';

app.listen(PORT, () => logger.info(`API Gateway running on port ${PORT}`));
```

---

## Step 9 — Local Test (Before Docker)

**Why:** catching a `pathRewrite` mistake locally takes seconds; catching the same mistake after a full Docker rebuild takes minutes. Always prove it works with `npm run dev` first.

**How:** with `auth-service`, `user-service`, and `room-service` all running locally (`npm run dev` in each of their terminals), start the Gateway:

```powershell
npx tsc --noEmit
npm run dev
```

Then, in a separate terminal, run these checks in order:

```powershell
curl http://localhost:4000/health
```

Expected: `{"status":"ok","service":"api-gateway"}`

```powershell
curl http://localhost:4000/api/auth/health
```

Expected: whatever `auth-service`'s own `/health`-equivalent route returns — if Auth doesn't have a plain `/health` under `/api/v1/auth`, test with a real route instead:

```powershell
curl -X POST http://localhost:4000/api/auth/signup -H "Content-Type: application/json" -d "{\"email\":\"gatewaytest@example.com\",\"password\":\"test1234\"}"
```

Expected: the same `201` response you'd get calling `localhost:4001/api/v1/auth/signup` directly — proving the `pathRewrite` correctly maps `/api/auth/signup` → `/api/v1/auth/signup` on the real service.

```powershell
curl http://localhost:4000/api/rooms
```

(with a real `Authorization: Bearer <token>` header from a login above) — expected: same response as hitting `localhost:4003/rooms` directly.

**Checkpoint:** every request through port `4000` behaves identically to hitting the target service's own port directly — the only difference the client should ever notice is the port number and path prefix.

---

## Step 10 — Dockerfile + `.dockerignore`

**Why:** this Dockerfile is noticeably shorter than auth/user/room's — no `prisma generate` step, because the Gateway has no database and no Prisma dependency at all.

**How:** create both files.

**Code — `Dockerfile`:**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY server.ts ./
RUN npm run build
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

**Code — `.dockerignore`:**

```
node_modules
.env
.env.docker
dist
.git
md
```

---

## Step 11 — `docker-compose.yml` Entry

**Why:** the placeholder block from Phase 0 already exists in your root compose file — it just needs the `env_file` pointed at the right file, the exact mistake caught (and fixed) in both Phase 3 and Phase 4.

**How:** open the root `docker-compose.yml` and update the `api-gateway` block.

**Code:**

```yaml
api-gateway:
  build: ./services/api-gateway
  container_name: api-gateway
  ports:
    - "4000:4000"
  env_file:
    - ./services/api-gateway/.env.docker
  depends_on:
    - auth-service
    - user-service
    - room-service
```

---

## Step 12 — Full Docker Test

**Why:** the final proof — the Gateway needs to resolve `auth-service`, `user-service`, and `room-service` **by their Docker container names**, which only works inside the Docker network, not from your host machine's `npm run dev`.

**How:**

```powershell
cd ..\..
docker compose build api-gateway
docker compose up -d api-gateway
docker logs api-gateway
```

Expected log: `API Gateway running on port 4000`, no `ECONNREFUSED` errors.

Re-run every check from Step 9 against `http://localhost:4000` — results should be identical, since Docker publishes the same host port.

**Extra check specific to Docker:** confirm a request actually reaches a container-networked service by name, not just that the Gateway itself boots:

```powershell
docker exec -it api-gateway wget -qO- http://auth-service:4001/health
```

If this returns a response, the Gateway container can genuinely reach Auth Service by its container name — proving `.env.docker` is correctly wired, not just present.

---

## Final Folder Structure

```
api-gateway/
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── routes/
│   │   └── proxyRoutes.ts
│   ├── middleware/
│   │   └── errorHandler.ts       (copied)
│   ├── utils/
│   │   ├── AppError.ts           (copied)
│   │   └── logger.ts             (copied)
│   └── app.ts
├── server.ts
├── package.json, package-lock.json, tsconfig.json
├── .env, .env.docker, .env.example
├── Dockerfile, .dockerignore
```

---

## Status Checklist

```
Step 0   Confirm real routes per service    [░░░░░░░░░░]  0%
Step 1   Branch + folders                   [░░░░░░░░░░]  0%
Step 2   package.json + deps                [░░░░░░░░░░]  0%
Step 3   Env files                          [░░░░░░░░░░]  0%
Step 4   Copied utils                       [░░░░░░░░░░]  0%
Step 5   config/env.ts                      [░░░░░░░░░░]  0%
Step 6   proxyRoutes.ts                     [░░░░░░░░░░]  0%
Step 7   app.ts                             [░░░░░░░░░░]  0%
Step 8   server.ts                          [░░░░░░░░░░]  0%
Step 9   Local test                         [░░░░░░░░░░]  0%
Step 10  Dockerfile + .dockerignore         [░░░░░░░░░░]  0%
Step 11  docker-compose.yml entry           [░░░░░░░░░░]  0%
Step 12  Full Docker test                   [░░░░░░░░░░]  0%
```

**Immediate next action:** Step 1 — create the branch and folder skeleton.
