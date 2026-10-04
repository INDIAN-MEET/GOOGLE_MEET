# Video Meet App — Next Phase Plan (Auth Wrap-Up → User Service)

> **Where you are:** Auth Service core is built, tested, and Dockerized (signup/login/refresh/logout/verify-token all working). This plan covers **two parts**: (A) the small remaining hardening items for Auth Service, and (B) the full, file-by-file build of **Phase 3 — User Service**, adapted to your actual stack (TypeScript, ES Modules, PostgreSQL + Prisma with the `prisma-client-js` generator, per-service Docker).

---

## Table of Contents

- [Part A — Auth Service: Final Hardening](#part-a--auth-service-final-hardening)
- [Part B — User Service: Full Build](#part-b--user-service-full-build)
- [Full Roadmap Position](#full-roadmap-position)

---

## Part A — Auth Service: Final Hardening

```mermaid
flowchart TD
    A1["A.1 — Check generated/prisma<br/>for stale leftovers"] --> A2["A.2 — Run /me 3-case test"]
    A2 --> A3["A.3 — Duplicate email → 409"]
    A3 --> A4["A.4 — onDelete Cascade<br/>+ new migration"]
    A4 --> A5["A.5 — .dockerignore"]
    A5 --> A6["A.6 — .env.example"]
    A6 --> A7["A.7 — Review .env.docker"]
    A7 --> A8["A.8 — README update"]
    A8 --> DONE(["🏁 Merge phase-0-auth-service → main"])

    style A1 fill:#fff4cc,stroke:#d99a2b
    style A2 fill:#fff4cc,stroke:#d99a2b
    style A3 fill:#ffd6d6,stroke:#d94a4a
    style A4 fill:#ffd6d6,stroke:#d94a4a
    style A5 fill:#dff3e4,stroke:#4a9b61
    style A6 fill:#dff3e4,stroke:#4a9b61
    style A7 fill:#dff3e4,stroke:#4a9b61
    style A8 fill:#dff3e4,stroke:#4a9b61
    style DONE fill:#d9e8ff,stroke:#4a78c2
```

### A.1 — Resolve `generated/prisma/` folder

```powershell
cat prisma\schema.prisma
```

If `generator client { provider = "prisma-client-js" }` has **no `output` line**, the `generated/prisma` folder is a stale leftover from before the generator switch:

```powershell
Remove-Item -Recurse generated
npx prisma generate
```

**Checkpoint:** `npx tsc --noEmit` passes with no errors.

### A.2 — Confirm `/me` route (proves `authGuard` works)

Three Postman tests against `GET /api/v1/auth/me`:

| Test       | Header                                       | Expected                                    |
| ---------- | -------------------------------------------- | ------------------------------------------- |
| No token   | —                                           | `401 "No token provided"`                 |
| Fake token | `Authorization: Bearer fake_token_123`     | `401 "Invalid or expired token"`          |
| Real token | `Authorization: Bearer <real accessToken>` | `200 { success: true, data: { userId } }` |

### A.3 — Duplicate email → clean `409`

In `signupController.ts`, inside the `catch` block:

```ts
if (err.code === 'P2002') {
  return next(new AppError('Email already exists', 409));
}
```

**Test:** signup twice with the same email → expect `409`, not `500`.

### A.4 — `onDelete: Cascade` on User ↔ RefreshToken

```prisma
model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String
  createdAt     DateTime       @default(now())
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String
  expiresAt DateTime
}
```

```powershell
npx prisma migrate dev --name add_user_relation
```

### A.5 — `.dockerignore`

```
node_modules
.env
.env.docker
dist
generated
.git
md
```

### A.6 — `.env.example`

```
PORT=4001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_db
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=replace_with_a_long_random_string
JWT_REFRESH_SECRET=replace_with_a_different_long_random_string
NODE_ENV=development
```

### A.7 — Review `.env.docker`

Confirm `postgres`/`redis` hostnames (not `localhost`), and that `docker-compose.yml`'s `auth-service.env_file` points to `.env.docker`.

### A.8 — README update

Document actual routes (`/api/v1/auth/*`, `/api/v1/internal/*`), how to run via `docker compose up -d auth-service`, and required env vars.

**Once A.1–A.8 are done → merge `phase-0-auth-service` into `main`, then branch `phase-3-user-service` off of it.**

---

## Part B — User Service: Full Build

**Goal:** the moment someone signs up via Auth, a matching profile automatically appears in `user_db` — via a Redis event, not a direct call. Then expose `GET/PATCH /me` for the logged-in user's own profile.

**New concepts this phase teaches:** Redis **subscribing** (you've only *published* so far), and reusing `authGuard` in a second service without importing code across services.

```mermaid
flowchart TD
    B1["B.1 — Folder structure"] --> B2["B.2 — package.json + deps"]
    B2 --> B3["B.3 — .env + .env.example + .env.docker"]
    B3 --> B4["B.4 — Prisma init + schema (Profile model)"]
    B4 --> B5["B.5 — Migration"]
    B5 --> B6["B.6 — db.ts (Prisma + adapter, same pattern as Auth)"]
    B6 --> B7["B.7 — redis.ts: SUBSCRIBE to user-created"]
    B7 --> B8["B.8 — Copy authGuard.ts from Auth (don't import)"]
    B8 --> B9["B.9 — meController.ts: GET /me"]
    B9 --> B10["B.10 — updateProfileController.ts: PATCH /me"]
    B10 --> B11["B.11 — Joi validation for PATCH body"]
    B11 --> B12["B.12 — routes/profileRoutes.ts"]
    B12 --> B13["B.13 — app.ts wiring"]
    B13 --> B14["B.14 — server.ts"]
    B14 --> B15["B.15 — Test: signup via Auth → profile auto-appears"]
    B15 --> B16["B.16 — Test: GET/PATCH /me via Postman"]
    B16 --> B17["B.17 — Dockerfile + docker-compose.yml entry"]
    B17 --> B18["B.18 — Full Docker test"]

    style B1 fill:#eef3ff,stroke:#5b7fff
    style B2 fill:#eef3ff,stroke:#5b7fff
    style B3 fill:#eef3ff,stroke:#5b7fff
    style B4 fill:#eef3ff,stroke:#5b7fff
    style B5 fill:#eef3ff,stroke:#5b7fff
    style B6 fill:#eef3ff,stroke:#5b7fff
    style B7 fill:#fff4cc,stroke:#d99a2b
    style B8 fill:#fff4cc,stroke:#d99a2b
    style B9 fill:#ffd6d6,stroke:#d94a4a
    style B10 fill:#ffd6d6,stroke:#d94a4a
    style B11 fill:#ffd6d6,stroke:#d94a4a
    style B12 fill:#ffd6d6,stroke:#d94a4a
    style B13 fill:#dff3e4,stroke:#4a9b61
    style B14 fill:#dff3e4,stroke:#4a9b61
    style B15 fill:#d9e8ff,stroke:#4a78c2
    style B16 fill:#d9e8ff,stroke:#4a78c2
    style B17 fill:#dff3e4,stroke:#4a9b61
    style B18 fill:#d9e8ff,stroke:#4a78c2
```

### B.1 — Branch + folder structure

```powershell
cd C:\Users\swaru\OneDrive\Desktop\PROJECT\GOOGLE_MEET
git checkout main
git checkout -b phase-3-user-service
cd services\user-service
mkdir src, src\config, src\controllers, src\middleware, src\routes, src\utils, src\validation, types, types\express
```

Target structure (mirrors auth-service):

```
user-service/
├── prisma/
├── src/
│   ├── config/       (db.ts, env.ts, redis.ts)
│   ├── controllers/  (meController.ts, updateProfileController.ts)
│   ├── middleware/   (authGuard.ts, errorHandler.ts, validate.ts)
│   ├── routes/       (profileRoutes.ts)
│   ├── utils/        (AppError.ts, logger.ts, response.ts)
│   ├── validation/   (profileSchemas.ts)
│   └── app.ts
├── types/express/index.d.ts
├── server.ts
├── package.json, tsconfig.json, .env, Dockerfile, .dockerignore
```

### B.2 — `package.json` + dependencies

```powershell
npm init -y
npm install express joi ioredis prisma @prisma/client @prisma/adapter-pg dotenv
npm install --save-dev typescript tsx @types/node @types/express
```

Add `"type": "module"` to `package.json`, and the same `scripts` block as auth-service (`dev`, `build`, `start`).

**Note:** no `bcrypt`/`jsonwebtoken` here — this service never touches passwords or issues tokens, only verifies them via the copied `authGuard`.

### B.3 — Environment files

`.env` (local dev):

```
PORT=4002
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/user_db"
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change_this_later_to_random_string
NODE_ENV=development
```

`.env.docker` (same but `postgres`/`redis` hostnames, `PORT=4002`).
`.env.example` (placeholders, committed).

**Important:** `JWT_ACCESS_SECRET` must be the **exact same value** as Auth Service's — otherwise tokens signed by Auth won't verify here.

### B.4 — Prisma schema

```powershell
npx prisma init
```

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Profile {
  id          String   @id @default(uuid())
  userId      String   @unique
  displayName String?
  avatarUrl   String?
  preferences Json?
  createdAt   DateTime @default(now())
}
```

`prisma.config.ts` — same pattern as auth-service (`datasource: { url: process.env["DATABASE_URL"] }`).

**Why `userId` is just a plain unique string, not a real foreign key:** it points to `auth_db.User.id` — a *different database*. No real FK is possible across databases; `@unique` is the closest equivalent (prevents two profiles for the same user).

### B.5 — Migration

```powershell
docker compose up -d postgres
npx prisma migrate dev --name init
```

**Checkpoint:**

```powershell
docker exec -it postgres psql -U postgres -d user_db -c "\dt"
```

`Profile` table should appear.

### B.6 — `src/config/db.ts` (identical pattern to Auth)

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DATABASE_URL } from './env.js';

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export default prisma;
```

Plus `src/config/env.ts` — same pattern as Auth's, exporting `PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`.

### B.7 — `src/config/redis.ts` — the new part: **subscribing**

```mermaid
sequenceDiagram
    participant Auth as Auth Service
    participant Redis
    participant User as User Service (this file)
    participant DB as user_db

    Note over User: On service boot —<br/>subscribe() runs once
    Auth->>Redis: publish("user-created", {userId})
    Redis-->>User: message event fires
    User->>User: JSON.parse(message)
    User->>DB: prisma.profile.create({ userId })
```

```ts
import Redis from 'ioredis';
import { REDIS_URL } from './env.js';
import prisma from './db.js';
import { logger } from '../utils/logger.js';

const subscriber = new Redis(REDIS_URL);

subscriber.subscribe('user-created', (err) => {
  if (err) logger.error('Redis subscribe error:', err);
  else logger.info('Subscribed to user-created channel');
});

subscriber.on('message', async (channel, message) => {
  if (channel === 'user-created') {
    try {
      const { userId } = JSON.parse(message);
      await prisma.profile.create({ data: { userId } });
      logger.info(`Profile auto-created for userId: ${userId}`);
    } catch (err) {
      logger.error('Failed to create profile from event:', err);
    }
  }
});

export default subscriber;
```

**Key line to understand:** `subscriber.subscribe(channel, callback)` registers interest; `subscriber.on('message', ...)` is where you **react** every time a message arrives — these are two separate steps, unlike a simple one-time request.

**This file must be imported once in `server.ts`** (even though nothing calls a function on it) — just importing it runs the `subscribe()` call at boot.

### B.8 — Copy `authGuard.ts` from Auth Service (don't import across services!)

```powershell
Copy-Item ..\auth-service\src\middleware\authGuard.ts src\middleware\authGuard.ts
Copy-Item ..\auth-service\src\utils\AppError.ts src\utils\AppError.ts
Copy-Item ..\auth-service\src\middleware\errorHandler.ts src\middleware\errorHandler.ts
Copy-Item ..\auth-service\src\utils\response.ts src\utils\response.ts
Copy-Item ..\auth-service\types\express\index.d.ts types\express\index.d.ts
```

**Why copy, not import:** importing across `/services/*` folders would create a hidden coupling between two services that are supposed to be independently deployable — the exact rule from Day 1 ("no service imports another service's code"). A few duplicated files is the correct tradeoff.

### B.9 — `src/controllers/meController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';

export const meController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: req.userId },
    });

    if (!profile) {
      return next(new AppError('Profile not found', 404));
    }

    successResponse(res, { profile });
  } catch (err) {
    next(err);
  }
};
```

### B.10 — `src/controllers/updateProfileController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { successResponse } from '../utils/response.js';

export const updateProfileController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { displayName, avatarUrl, preferences } = req.body;

    const profile = await prisma.profile.update({
      where: { userId: req.userId },
      data: { displayName, avatarUrl, preferences },
    });

    successResponse(res, { profile });
  } catch (err) {
    next(err);
  }
};
```

### B.11 — `src/validation/profileSchemas.ts`

```ts
import Joi from 'joi';

export const updateProfileSchema = Joi.object({
  displayName: Joi.string().max(50).optional(),
  avatarUrl: Joi.string().uri().optional(),
  preferences: Joi.object().optional(),
});
```

**Note:** all fields `.optional()` — a `PATCH` shouldn't force the client to resend every field, only what's changing.

### B.12 — `src/routes/profileRoutes.ts`

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.js';
import { validateMiddleware } from '../middleware/validate.js';
import { updateProfileSchema } from '../validation/profileSchemas.js';
import { meController } from '../controllers/meController.js';
import { updateProfileController } from '../controllers/updateProfileController.js';

const router = Router();

router.get('/me', authGuard, meController);
router.patch('/me', authGuard, validateMiddleware(updateProfileSchema), updateProfileController);

export default router;
```

### B.13 — `src/app.ts`

```ts
import express from 'express';
import profileRoutes from './routes/profileRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import './config/redis.js'; // side-effect import: starts the subscriber

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'user-service' }));
app.use('/', profileRoutes);

app.use(errorHandler); // always last
export default app;
```

**Note the `import './config/redis.js'`** with no named import — this is a deliberate **side-effect import**: we don't need anything *from* the file, we just need its top-level code (the `subscribe()` call) to run once, at boot.

### B.14 — `server.ts`

```ts
import app from './src/app.js';
import { PORT } from './src/config/env.js';
import { logger } from './src/utils/logger.js';

app.listen(PORT, () => logger.info(`User Service running on port ${PORT}`));
```

### B.15 — Test the event pipeline end-to-end

```mermaid
sequenceDiagram
    participant You as You (Postman)
    participant Auth as Auth Service :4001
    participant Redis
    participant User as User Service :4002
    participant UDB as user_db

    You->>Auth: POST /api/v1/auth/signup
    Auth->>Redis: publish user-created
    Redis-->>User: message delivered
    User->>UDB: INSERT Profile
    You->>UDB: (verify manually)
```

1. Make sure both services are running locally (`npm run dev` in both terminals) and Redis is up.
2. `POST http://localhost:4001/api/v1/auth/signup` with a fresh email.
3. Check `user_db` directly:

```powershell
docker exec -it postgres psql -U postgres -d user_db -c "SELECT * FROM \"Profile\";"
```

A new row should appear **automatically**, with no request ever sent to User Service.

### B.16 — Test `GET`/`PATCH /me`

1. Login via Auth → get `accessToken`.
2. `GET http://localhost:4002/me` with `Authorization: Bearer <token>` → expect the auto-created (empty) profile.
3. `PATCH http://localhost:4002/me` with `{ "displayName": "Test User" }` → expect updated profile back.

### B.17 — Dockerfile (same pattern as auth-service, port 4002)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src
COPY server.ts ./
COPY types ./types
RUN npx prisma generate
RUN npm run build
EXPOSE 4002
CMD ["node", "dist/server.js"]
```

Add `.dockerignore` (same content as auth-service's).

Add to root `docker-compose.yml` (the `user-service` block already exists as a placeholder from Phase 0 — confirm it points to `.env.docker` and depends on `postgres` + `redis`).

### B.18 — Full Docker test

```powershell
cd ..\..
docker compose build --no-cache user-service
docker compose up -d user-service
docker logs user-service
```

Expected: `Redis connected` / `Subscribed to user-created channel` / `User Service running on port 4002`.

Then re-run B.15 and B.16 through Docker instead of local `npm run dev`.

---

## Full Roadmap Position

```mermaid
flowchart LR
    P0["Phase 0<br/>Skeleton ✅"] --> P1["Phase 1<br/>Gateway"]
    P1 --> P2["Phase 2<br/>Auth ✅ (hardening left)"]
    P2 --> P3["Phase 3<br/>User ← YOU ARE HERE"]
    P3 --> P4["Phase 4<br/>Room"]
    P4 --> P5["Phase 5<br/>Signaling"]

    style P0 fill:#d4f7d4,stroke:#3fae3f
    style P2 fill:#fff4cc,stroke:#d99a2b
    style P3 fill:#ffd6d6,stroke:#d94a4a
    style P1 fill:#eef3ff,stroke:#5b7fff
    style P4 fill:#eef3ff,stroke:#5b7fff
    style P5 fill:#eef3ff,stroke:#5b7fff
```

**Note on Phase 1 (API Gateway):** it hasn't been built yet, but Auth and User services have both been tested by hitting their ports directly (`4001`, `4002`) — that's fine for now. The Gateway will be built once 2–3 services exist, since a gateway with only one real backend to proxy to isn't very informative to build in isolation.

**Immediate next action:** finish Part A (Auth hardening, ~8 small items) if not already done, then start Part B, Step B.1.
