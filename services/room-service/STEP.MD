# Video Meet App — Phase 4: Room Service (Full Build Plan)

> **Where you are:** Auth Service ✅ Done. User Service ✅ Done (signup → auto profile creation via Redis, GET/PATCH `/me` working). Both Dockerized and tested.
>
> **This phase:** Build **Room Service** — creates and manages "meeting rooms" (like a Google Meet call link). A logged-in user can create a room, get a shareable room code, and other users can join that room using the code. This is the service that Signaling Service (Phase 5) will later depend on to know who's allowed in a call.

---

## Table of Contents

- [1. Where This Fits in the Roadmap](#1-where-this-fits-in-the-roadmap)
- [2. What Room Service Actually Does](#2-what-room-service-actually-does)
- [3. Data Model](#3-data-model)
- [4. Full Request Flow](#4-full-request-flow)
- [5. Build Steps — File by File](#5-build-steps--file-by-file)
- [6. Folder Structure](#6-folder-structure)
- [7. Testing Plan](#7-testing-plan)
- [8. Docker Integration](#8-docker-integration)
- [9. Status Checklist](#9-status-checklist)

---

## 1. Where This Fits in the Roadmap

```mermaid
flowchart LR
    P0["Phase 0<br/>Skeleton ✅"] --> P1["Phase 1<br/>Gateway"]
    P1 --> P2["Phase 2<br/>Auth ✅"]
    P2 --> P3["Phase 3<br/>User ✅"]
    P3 --> P4["Phase 4<br/>Room ← YOU ARE HERE"]
    P4 --> P5["Phase 5<br/>Signaling"]
    P5 --> P6["Phase 6<br/>Chat"]

    style P0 fill:#d4f7d4,stroke:#3fae3f
    style P2 fill:#d4f7d4,stroke:#3fae3f
    style P3 fill:#d4f7d4,stroke:#3fae3f
    style P4 fill:#ffd6d6,stroke:#d94a4a
    style P1 fill:#eef3ff,stroke:#5b7fff
    style P5 fill:#eef3ff,stroke:#5b7fff
    style P6 fill:#eef3ff,stroke:#5b7fff
```

**Why Room before Signaling:** Signaling Service (WebRTC connections) needs to know "is this room real, and is this user allowed in it" *before* it lets two browsers exchange video streams. Room Service is the source of truth for that.

---

## 2. What Room Service Actually Does

In plain terms — this is the service that answers three questions:

1. **"Can I start a new meeting?"** → creates a `Room` row, generates a short shareable code (e.g. `abc-defg-hij`, Google Meet style)
2. **"Can I join this meeting?"** → checks the room exists and isn't closed, adds the user as a `RoomParticipant`
3. **"Who's in this meeting / what meetings am I in?"** → lookups for the frontend to display

**It does NOT handle video/audio streams** — that's Signaling Service's job later. Room Service is purely the "reception desk" — who's allowed in, and who's currently inside.

---

## 3. Data Model

```mermaid
erDiagram
    Room ||--o{ RoomParticipant : has
    Room {
        string id PK
        string code UK "shareable join code"
        string hostUserId "from Auth, no real FK"
        string title
        boolean isActive
        datetime createdAt
        datetime endedAt
    }
    RoomParticipant {
        string id PK
        string roomId FK
        string userId "from Auth, no real FK"
        datetime joinedAt
        datetime leftAt
    }
```

**Same cross-database rule as Profile.userId (Phase 3):** `hostUserId` and `RoomParticipant.userId` point to `auth_db.User.id`, but Room Service has its **own database** (`room_db`). No real foreign key is possible across databases — so these are plain `String` fields, not `@relation`. Only `RoomParticipant.roomId → Room.id` gets a real Prisma `@relation`, because both tables live in the same `room_db`.

```prisma
model Room {
  id           String            @id @default(uuid())
  code         String            @unique
  hostUserId   String
  title        String?
  isActive     Boolean           @default(true)
  createdAt    DateTime          @default(now())
  endedAt      DateTime?
  participants RoomParticipant[]
}

model RoomParticipant {
  id       String    @id @default(uuid())
  roomId   String
  room     Room      @relation(fields: [roomId], references: [id], onDelete: Cascade)
  userId   String
  joinedAt DateTime  @default(now())
  leftAt   DateTime?
}
```

**Why `onDelete: Cascade` here too:** if a `Room` is ever deleted, its `RoomParticipant` rows become meaningless orphans — same reasoning as `RefreshToken → User` in Auth Service.

---

## 4. Full Request Flow

### 4.1 — Create Room

```mermaid
sequenceDiagram
    participant You as Client
    participant Room as Room Service :4003
    participant Auth as (verifies token via authGuard copy)
    participant DB as room_db

    You->>Room: POST /rooms<br/>Authorization: Bearer accessToken
    Room->>Auth: authGuard verifies JWT locally
    Auth-->>Room: req.userId set
    Room->>Room: generate unique room code
    Room->>DB: INSERT Room (hostUserId, code)
    DB-->>Room: new Room row
    Room-->>You: 201 { roomId, code }
```

**Key point — same `authGuard` pattern as User Service:** Room Service does **not** call Auth Service over HTTP to verify tokens. It has its **own copy** of `authGuard.ts` (same `JWT_ACCESS_SECRET`), and verifies the JWT locally — no network hop needed for every request. This is the same "copy, don't import" rule from Phase 3.

### 4.2 — Join Room

```mermaid
sequenceDiagram
    participant You as Client (User B)
    participant Room as Room Service :4003
    participant DB as room_db

    You->>Room: POST /rooms/:code/join<br/>Authorization: Bearer accessToken
    Room->>DB: findUnique Room by code
    alt Room not found or isActive = false
        Room-->>You: 404 "Room not found or ended"
    else Room exists and active
        Room->>DB: INSERT RoomParticipant (roomId, userId)
        Room-->>You: 200 { roomId, participants }
    end
```

### 4.3 — Leave Room / End Room

```mermaid
sequenceDiagram
    participant You as Client
    participant Room as Room Service :4003
    participant DB as room_db

    You->>Room: POST /rooms/:code/leave
    Room->>DB: UPDATE RoomParticipant SET leftAt = now()
    Room-->>You: 200 OK

    Note over You,DB: Separately — only the host can end the room
    You->>Room: POST /rooms/:code/end
    Room->>DB: check hostUserId === req.userId
    alt Not the host
        Room-->>You: 403 Forbidden
    else Is the host
        Room->>DB: UPDATE Room SET isActive = false, endedAt = now()
        Room-->>You: 200 OK
    end
```

---

## 5. Build Steps — File by File

```mermaid
flowchart TD
    C1["C.1 — Folder structure"] --> C2["C.2 — package.json + deps"]
    C2 --> C3["C.3 — .env / .env.docker / .env.example"]
    C3 --> C4["C.4 — Prisma schema (Room, RoomParticipant)"]
    C4 --> C5["C.5 — Migration"]
    C5 --> C6["C.6 — db.ts"]
    C6 --> C7["C.7 — Copy authGuard.ts, AppError.ts, errorHandler.ts, response.ts"]
    C7 --> C8["C.8 — utils/roomCode.ts (code generator)"]
    C8 --> C9["C.9 — createRoomController.ts"]
    C9 --> C10["C.10 — joinRoomController.ts"]
    C10 --> C11["C.11 — leaveRoomController.ts"]
    C11 --> C12["C.12 — endRoomController.ts"]
    C12 --> C13["C.13 — getRoomController.ts"]
    C13 --> C14["C.14 — validation/roomSchemas.ts"]
    C14 --> C15["C.15 — routes/roomRoutes.ts"]
    C15 --> C16["C.16 — app.ts + server.ts"]
    C16 --> C17["C.17 — Local test (npm run dev)"]
    C17 --> C18["C.18 — Dockerfile + .dockerignore"]
    C18 --> C19["C.19 — docker-compose.yml entry"]
    C19 --> C20["C.20 — Full Docker test"]

    style C1 fill:#eef3ff,stroke:#5b7fff
    style C2 fill:#eef3ff,stroke:#5b7fff
    style C3 fill:#eef3ff,stroke:#5b7fff
    style C4 fill:#eef3ff,stroke:#5b7fff
    style C5 fill:#eef3ff,stroke:#5b7fff
    style C6 fill:#eef3ff,stroke:#5b7fff
    style C7 fill:#fff4cc,stroke:#d99a2b
    style C8 fill:#fff4cc,stroke:#d99a2b
    style C9 fill:#ffd6d6,stroke:#d94a4a
    style C10 fill:#ffd6d6,stroke:#d94a4a
    style C11 fill:#ffd6d6,stroke:#d94a4a
    style C12 fill:#ffd6d6,stroke:#d94a4a
    style C13 fill:#ffd6d6,stroke:#d94a4a
    style C14 fill:#ffd6d6,stroke:#d94a4a
    style C15 fill:#dff3e4,stroke:#4a9b61
    style C16 fill:#dff3e4,stroke:#4a9b61
    style C17 fill:#d9e8ff,stroke:#4a78c2
    style C18 fill:#dff3e4,stroke:#4a9b61
    style C19 fill:#dff3e4,stroke:#4a9b61
    style C20 fill:#d9e8ff,stroke:#4a78c2
```

### C.1 — Folder + branch

```powershell
cd C:\Users\swaru\OneDrive\Desktop\PROJECT\GOOGLE_MEET
git checkout main
git checkout -b phase-4-room-service
cd services\room-service
mkdir src, src\config, src\controllers, src\middleware, src\routes, src\utils, src\validation, types, types\express
```

### C.2 — `package.json` + dependencies

```powershell
npm init -y
npm install express joi ioredis prisma @prisma/client @prisma/adapter-pg dotenv jsonwebtoken pino pino-http
npm install --save-dev typescript tsx @types/node @types/express @types/jsonwebtoken pino-pretty
```

**Note:** `jsonwebtoken` + `pino`/`pino-http` are needed here (unlike User Service's list) because we're copying `authGuard.ts` and `logger.ts`, which import them directly — this is the exact gap that caused the User Service build error earlier, so we install them upfront this time.

Set in `package.json`:

```json
"type": "module",
"scripts": {
  "dev": "tsx watch server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```

### C.3 — Environment files

**`.env`** (local dev, `localhost` hosts):

```
PORT=4003
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/room_db"
JWT_ACCESS_SECRET=<same value as auth-service>
NODE_ENV=development
```

**`.env.docker`** (container, Docker service names — **this is the file that must NOT contain `localhost`**, per the bug you hit in Phase 3):

```
PORT=4003
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/room_db"
JWT_ACCESS_SECRET=<same value as auth-service>
NODE_ENV=production
```

**`.env.example`** (committed, placeholders):

```
PORT=4003
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/room_db
JWT_ACCESS_SECRET=replace_with_same_secret_as_auth_service
NODE_ENV=development
```

> Room Service has **no Redis dependency** in this phase — it doesn't publish or subscribe to anything yet. (Signaling Service, Phase 5, is what will care about live participant presence via Redis.)

### C.4 — Prisma schema

```powershell
npx prisma init
```

Use the schema from [Section 3](#3-data-model) above. Same `prisma.config.ts` pattern as the other two services.

### C.5 — Migration

```powershell
docker compose up -d postgres
npx prisma migrate dev --name init
```

**Checkpoint:**

```powershell
docker exec -it postgres psql -U postgres -d room_db
```

```sql
\dt
```

`Room` and `RoomParticipant` should both appear.

### C.6 — `src/config/db.ts` + `src/config/env.ts`

Identical pattern to Auth/User Service — Prisma adapter-pg, exporting `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`.

### C.7 — Copy shared middleware (don't import across services)

```powershell
Copy-Item ..\auth-service\src\middleware\authGuard.ts src\middleware\authGuard.ts
Copy-Item ..\auth-service\src\utils\AppError.ts src\utils\AppError.ts
Copy-Item ..\auth-service\src\middleware\errorHandler.ts src\middleware\errorHandler.ts
Copy-Item ..\auth-service\src\utils\response.ts src\utils\response.ts
Copy-Item ..\auth-service\src\utils\logger.ts src\utils\logger.ts
Copy-Item ..\auth-service\types\express\index.d.ts types\express\index.d.ts
```

### C.8 — `src/utils/roomCode.ts`

```ts
// Generates a short, human-shareable code like "abc-defg-hij"
export function generateRoomCode(): string {
  const segment = (len: number) =>
    Math.random().toString(36).substring(2, 2 + len);
  return `${segment(3)}-${segment(4)}-${segment(3)}`;
}
```

**Why not just use the UUID as the code:** UUIDs (`a5a7ac02-02f0-4498-...`) are painful to read aloud or type into a "join meeting" box. A short code is the actual link people share — same idea as Google Meet's `abc-defg-hij` format.

### C.9 — `src/controllers/createRoomController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { successResponse } from '../utils/response.js';

export const createRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title } = req.body;
    const code = generateRoomCode();

    const room = await prisma.room.create({
      data: { code, hostUserId: req.userId, title },
    });

    successResponse(res, { room }, 201);
  } catch (err) {
    next(err);
  }
};
```

### C.10 — `src/controllers/joinRoomController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';

export const joinRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;

    const room = await prisma.room.findUnique({ where: { code } });

    if (!room || !room.isActive) {
      return next(new AppError('Room not found or has ended', 404));
    }

    const participant = await prisma.roomParticipant.create({
      data: { roomId: room.id, userId: req.userId },
    });

    successResponse(res, { room, participant });
  } catch (err) {
    next(err);
  }
};
```

### C.11 — `src/controllers/leaveRoomController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';

export const leaveRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const room = await prisma.room.findUnique({ where: { code } });

    if (!room) return next(new AppError('Room not found', 404));

    await prisma.roomParticipant.updateMany({
      where: { roomId: room.id, userId: req.userId, leftAt: null },
      data: { leftAt: new Date() },
    });

    successResponse(res, { message: 'Left room' });
  } catch (err) {
    next(err);
  }
};
```

### C.12 — `src/controllers/endRoomController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';

export const endRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const room = await prisma.room.findUnique({ where: { code } });

    if (!room) return next(new AppError('Room not found', 404));
    if (room.hostUserId !== req.userId) {
      return next(new AppError('Only the host can end this room', 403));
    }

    const updated = await prisma.room.update({
      where: { code },
      data: { isActive: false, endedAt: new Date() },
    });

    successResponse(res, { room: updated });
  } catch (err) {
    next(err);
  }
};
```

**This is the one controller with real authorization logic** (not just authentication) — it checks *who* is asking, not just *that* they're logged in. Worth noticing as a pattern you'll reuse.

### C.13 — `src/controllers/getRoomController.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { successResponse } from '../utils/response.js';

export const getRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const room = await prisma.room.findUnique({
      where: { code },
      include: { participants: { where: { leftAt: null } } },
    });

    if (!room) return next(new AppError('Room not found', 404));

    successResponse(res, { room });
  } catch (err) {
    next(err);
  }
};
```

**First real use of `include`** in this project — fetches the `Room` and its currently-active `participants` (`leftAt: null`) in one query, using the `RoomParticipant → Room` relation defined in the schema.

### C.14 — `src/validation/roomSchemas.ts`

```ts
import Joi from 'joi';

export const createRoomSchema = Joi.object({
  title: Joi.string().max(100).optional(),
});
```

### C.15 — `src/routes/roomRoutes.ts`

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.js';
import { validateMiddleware } from '../middleware/validate.js';
import { createRoomSchema } from '../validation/roomSchemas.js';
import { createRoomController } from '../controllers/createRoomController.js';
import { joinRoomController } from '../controllers/joinRoomController.js';
import { leaveRoomController } from '../controllers/leaveRoomController.js';
import { endRoomController } from '../controllers/endRoomController.js';
import { getRoomController } from '../controllers/getRoomController.js';

const router = Router();

router.post('/rooms', authGuard, validateMiddleware(createRoomSchema), createRoomController);
router.get('/rooms/:code', authGuard, getRoomController);
router.post('/rooms/:code/join', authGuard, joinRoomController);
router.post('/rooms/:code/leave', authGuard, leaveRoomController);
router.post('/rooms/:code/end', authGuard, endRoomController);

export default router;
```

### C.16 — `src/app.ts` + `server.ts`

Same pattern as User Service's `app.ts`/`server.ts` — but **no Redis side-effect import** this phase (no subscriber needed yet).

```ts
// src/app.ts
import express from 'express';
import roomRoutes from './routes/roomRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'room-service' }));
app.use('/', roomRoutes);
app.use(errorHandler);
export default app;
```

### C.17 — Local test (before Docker)

```powershell
npx tsc --noEmit
npm run dev
```

Fix any missing-package errors the same way as Phase 3 — check every copied file's imports against `package.json` dependencies before moving to Docker.

### C.18 — Dockerfile (port 4003)

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
EXPOSE 4003
CMD ["node", "dist/server.js"]
```

`.dockerignore` — same content as the other two services.

### C.19 — `docker-compose.yml`

Your root file **already has a `room-service` placeholder block**:

```yaml
room-service:
  build: ./services/room-service
  container_name: room-service
  ports:
    - "4003:4003"
  env_file:
    - ./services/room-service/.env
  depends_on:
    - postgres
    - auth-service
```

**One line needs to change before you build** — this is the same mistake caught twice in Phase 3, so check it *before* running into it a third time:

```yaml
env_file:
  - ./services/room-service/.env.docker    # not .env
```

### C.20 — Full Docker test

```powershell
cd ..\..
docker compose build room-service
docker compose up -d room-service
docker logs room-service
```

Expected: `Room Service running on port 4003`, no `ECONNREFUSED`, no `TypeError`.

---

## 6. Folder Structure

```
room-service/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── config/
│   │   ├── db.ts
│   │   └── env.ts
│   ├── controllers/
│   │   ├── createRoomController.ts
│   │   ├── joinRoomController.ts
│   │   ├── leaveRoomController.ts
│   │   ├── endRoomController.ts
│   │   └── getRoomController.ts
│   ├── middleware/
│   │   ├── authGuard.ts        (copied)
│   │   ├── errorHandler.ts     (copied)
│   │   └── validate.ts
│   ├── routes/
│   │   └── roomRoutes.ts
│   ├── utils/
│   │   ├── AppError.ts         (copied)
│   │   ├── logger.ts           (copied)
│   │   ├── response.ts         (copied)
│   │   └── roomCode.ts
│   ├── validation/
│   │   └── roomSchemas.ts
│   └── app.ts
├── types/express/index.d.ts    (copied)
├── server.ts
├── package.json, tsconfig.json
├── .env, .env.docker, .env.example
├── Dockerfile, .dockerignore
```

---

## 7. Testing Plan

| # | Test                  | Steps                                                     | Expected                               |
| - | --------------------- | --------------------------------------------------------- | -------------------------------------- |
| 1 | Create room           | Login via Auth →`POST /rooms` with token               | `201`, returns `code`              |
| 2 | Get room              | `GET /rooms/:code` with token                           | `200`, room + empty `participants` |
| 3 | Join room             | Second login (or same user) →`POST /rooms/:code/join`  | `200`, participant added             |
| 4 | Get room again        | `GET /rooms/:code`                                      | `participants` array now has 1 entry |
| 5 | Non-host tries to end | Login as a*different* user → `POST /rooms/:code/end` | `403 Forbidden`                      |
| 6 | Host ends room        | Login as host →`POST /rooms/:code/end`                 | `200`, `isActive: false`           |
| 7 | Join ended room       | `POST /rooms/:code/join` after ending                   | `404 "Room not found or has ended"`  |
| 8 | No token              | Any route without`Authorization` header                 | `401`                                |

---

## 8. Docker Integration

```mermaid
flowchart TD
    subgraph Docker Network
        PG[(postgres<br/>room_db)]
        AUTH[auth-service<br/>:4001]
        ROOM[room-service<br/>:4003]
    end

    Client -->|POST /rooms<br/>Bearer token| ROOM
    ROOM -->|verifies JWT locally<br/>via copied authGuard| ROOM
    ROOM -->|Prisma queries| PG
    ROOM -.depends_on.-> AUTH
    ROOM -.depends_on.-> PG

    style ROOM fill:#ffd6d6,stroke:#d94a4a
```

**Why `depends_on: auth-service` even though Room Service never calls it over HTTP:** it's a **startup-order hint**, not a runtime dependency — mainly documents intent ("this service is logically downstream of Auth") for anyone reading the compose file. The actual dependency that matters at runtime is `JWT_ACCESS_SECRET` being identical, not a live network call.

---

## 9. Status Checklist

```
C.1  Folder structure           [░░░░░░░░░░]  0%
C.2  package.json + deps        [░░░░░░░░░░]  0%
C.3  Env files                  [░░░░░░░░░░]  0%
C.4  Prisma schema               [░░░░░░░░░░]  0%
C.5  Migration                  [░░░░░░░░░░]  0%
C.6  db.ts / env.ts             [░░░░░░░░░░]  0%
C.7  Copied middleware/utils    [░░░░░░░░░░]  0%
C.8  roomCode.ts                [░░░░░░░░░░]  0%
C.9  createRoomController       [░░░░░░░░░░]  0%
C.10 joinRoomController         [░░░░░░░░░░]  0%
C.11 leaveRoomController        [░░░░░░░░░░]  0%
C.12 endRoomController          [░░░░░░░░░░]  0%
C.13 getRoomController          [░░░░░░░░░░]  0%
C.14 roomSchemas.ts             [░░░░░░░░░░]  0%
C.15 roomRoutes.ts              [░░░░░░░░░░]  0%
C.16 app.ts / server.ts         [░░░░░░░░░░]  0%
C.17 Local test                 [░░░░░░░░░░]  0%
C.18 Dockerfile                 [░░░░░░░░░░]  0%
C.19 docker-compose.yml fix     [░░░░░░░░░░]  0%
C.20 Full Docker test           [░░░░░░░░░░]  0%
```

**Immediate next action:** C.1 — create the branch and folder structure, then work straight down the table.
