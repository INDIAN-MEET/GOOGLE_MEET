
# Phase 11: Notification Service (Detailed Build Guide)

> **Service:** `services/notification-service`
> **Port:** `4006` (4005 = chat, 4007 = recording, so 4006 is free)
> **Database:** PostgreSQL `notification_db` (Prisma)
> **Queue:** BullMQ on Redis
> **Email:** Nodemailer (Mailpit in dev, real SMTP in prod)

---

## 0. Read This First

### 0.1 What this phase builds

1. A host can **invite people by email** to a room (`POST /api/v1/notifications/invites`).
2. If the room is **scheduled** (`scheduledAt`), the service automatically sends **reminders** (15 min and 5 min before).
3. If the room is **ended/cancelled**, pending reminders are **cancelled**.
4. All emails are sent **asynchronously** through a BullMQ queue with **retries**, so the HTTP request never waits for SMTP.

### 0.2 Assumptions (check these against your code)

I have not seen your source files, only the structure and docs. These are my assumptions. If any differ, adjust the marked line.

| #  | Assumption                                                                                             | Where it matters                                                     |
| -- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A1 | Prisma 7 style (`generated/prisma`, `prisma.config.ts`, driver adapter), same as recording-service | `src/config/prisma.ts`                                             |
| A2 | JWT payload has the user id in `userId` (falls back to `sub`)                                      | `src/middleware/authGuard.ts`                                      |
| A3 | `GET /v1/rooms/:code` returns `{ data: { room: { code, title, hostId, scheduledAt, status } } }`   | `src/config/roomServiceClient.ts`                                  |
| A4 | Success responses look like `{ success: true, data: ... }`                                           | controllers                                                          |
| A5 | ESM + TypeScript with `tsx` for dev, same as your other services                                     | imports use `.js` suffix only if recording-service does. Match it. |

> **Tip:** When in doubt, copy the equivalent file from `recording-service` and compare it with this guide.

### 0.3 Architecture of this phase

```mermaid
flowchart LR
    U["Host (browser)"] -->|"POST /api/v1/notifications/invites"| GW["API Gateway :4000"]
    GW --> NS["Notification Service :4006"]
    NS -->|"GET /v1/rooms/:code (host check)"| RS["Room Service :4003"]
    NS -->|"insert Notification rows"| DB[("notification_db")]
    NS -->|"add jobs (delay for reminders)"| Q[("Redis: BullMQ queue")]
    Q --> W["Email Worker (inside notification-service)"]
    W -->|"SMTP"| M["Mailpit / real SMTP"]
    W -->|"update status SENT/FAILED"| DB
    RS -->|"PUBLISH room-events: room-ended"| R[("Redis Pub/Sub")]
    R -->|"SUBSCRIBE room-events"| NS
    NS -->|"cancel pending reminders"| Q
```

### 0.4 Build order for this phase

| Step  | What                                           | Files touched                                                          |
| ----- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| 11.1  | Infra: database, Mailpit, compose              | `init.sql`, `docker-compose.yml`                                   |
| 11.2  | Scaffold the service                           | `package.json`, `tsconfig.json`, `.env.example`, `Dockerfile`  |
| 11.3  | Config and utilities                           | `src/config/*`, `src/utils/*`                                      |
| 11.4  | Prisma schema and migration                    | `prisma/schema.prisma`, `prisma.config.ts`                         |
| 11.5  | Middleware and validation                      | `src/middleware/*`, `src/validation/*`                             |
| 11.6  | Email sending (SMTP + templates)               | `src/email/*`                                                        |
| 11.7  | BullMQ queue and worker                        | `src/queue/*`                                                        |
| 11.8  | Business logic (invites, reminders, cancel)    | `src/services/notificationService.ts`                                |
| 11.9  | HTTP API (controllers, routes, app, server)    | `src/controllers/*`, `src/routes/*`, `src/app.ts`, `server.ts` |
| 11.10 | Room-service changes (`scheduledAt`, events) | `services/room-service/*`                                            |
| 11.11 | Redis event subscriber (cancel reminders)      | `src/subscribers/roomEventsSubscriber.ts`                            |
| 11.12 | Gateway proxy                                  | `services/api-gateway/src/routes/proxyRoutes.ts`                     |
| 11.13 | E2E test script                                | `scripts/e2e-notification.mjs`                                       |
| 11.14 | Verification checklist and troubleshooting     | n/a                                                                    |

---

## Final Folder Structure

```
services/notification-service/
├── prisma/
│   ├── migrations/                  (created by prisma migrate)
│   └── schema.prisma
├── scripts/
│   └── e2e-notification.mjs
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   └── roomServiceClient.ts
│   ├── controllers/
│   │   ├── healthController.ts
│   │   └── inviteController.ts
│   ├── email/
│   │   ├── sendEmail.ts
│   │   ├── templates.ts
│   │   └── transporter.ts
│   ├── middleware/
│   │   ├── authGuard.ts
│   │   ├── errorHandler.ts
│   │   └── validate.ts
│   ├── queue/
│   │   ├── emailWorker.ts
│   │   └── queues.ts
│   ├── routes/
│   │   └── notificationRoutes.ts
│   ├── services/
│   │   └── notificationService.ts
│   ├── subscribers/
│   │   └── roomEventsSubscriber.ts
│   ├── utils/
│   │   ├── AppError.ts
│   │   ├── asyncHandler.ts
│   │   └── logger.ts
│   ├── validation/
│   │   └── notificationSchemas.ts
│   └── app.ts
├── types/express/index.d.ts
├── .env.example
├── Dockerfile
├── package.json
├── prisma.config.ts
├── server.ts
└── tsconfig.json
```

---

## Step 11.1: Infrastructure (database, Mailpit, compose)

### What and why

- The service needs its **own database** (`notification_db`), following your one-DB-per-service rule.
- In development we do **not** send real email. **Mailpit** is a fake SMTP server with a web inbox at `http://localhost:8025`. Every email the service sends lands there.

### 11.1.1 File: `infra/postgres-init/init.sql` (append)

```sql
-- Phase 11: notification service database
CREATE DATABASE notification_db;
```

> **Important:** Postgres only runs init scripts on a **fresh volume**. If your Postgres volume already exists, run this once manually:
> `docker compose exec postgres psql -U postgres -c "CREATE DATABASE notification_db;"`
> (use your real Postgres user name).

### 11.1.2 File: `docker-compose.yml` (add these services)

```yaml
  # ---------------------------------------------------------------
  # Mailpit: fake SMTP server for development.
  #   SMTP  -> mailpit:1025  (the service sends here)
  #   Web UI -> http://localhost:8025 (you read emails here)
  # ---------------------------------------------------------------
  mailpit:
    image: axllent/mailpit:latest
    container_name: mailpit
    ports:
      - "1025:1025"
      - "8025:8025"

  # ---------------------------------------------------------------
  # Notification service (Phase 11)
  # ---------------------------------------------------------------
  notification-service:
    build:
      context: ./services/notification-service
      dockerfile: Dockerfile
    container_name: notification-service
    ports:
      - "4006:4006"
    env_file:
      - ./services/notification-service/.env.docker
    depends_on:
      - postgres
      - redis
      - mailpit
```

> Adjust `postgres` and `redis` to the service names you used in your compose file.

---

## Step 11.2: Scaffold the service

### 11.2.1 Commands

```bash
mkdir -p services/notification-service && cd services/notification-service
npm init -y
npm install express cors helmet pino pino-http dotenv joi jsonwebtoken axios \
            ioredis bullmq nodemailer @prisma/client @prisma/adapter-pg pg
npm install -D typescript tsx prisma @types/node @types/express @types/cors \
               @types/jsonwebtoken @types/nodemailer @types/pg
```

### 11.2.2 File: `services/notification-service/package.json` (scripts and type)

```json
{
  "name": "notification-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy"
  }
}
```

> Keep the `dependencies` that `npm install` wrote. Only add `type` and `scripts`. If your other services are CommonJS, drop `"type": "module"` and match them.

### 11.2.3 File: `services/notification-service/tsconfig.json`

Copy `recording-service/tsconfig.json` unchanged. If you need a starting point:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["server.ts", "src/**/*.ts", "types/**/*.d.ts", "generated/**/*.ts"]
}
```

### 11.2.4 File: `services/notification-service/.env.example`

```env
# --- Server ---
NODE_ENV=development
PORT=4006

# --- Auth (same secret as every other service) ---
JWT_ACCESS_SECRET=change-me

# --- Database ---
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/notification_db

# --- Redis (queue + pub/sub) ---
REDIS_URL=redis://localhost:6379

# --- Room service (host check) ---
ROOM_SERVICE_URL=http://localhost:4003

# --- SMTP (dev = Mailpit) ---
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Video Meet <no-reply@videomeet.local>"

# --- Links inside emails ---
FRONTEND_URL=http://localhost:5173

# --- Reminder offsets in minutes before the meeting, comma separated ---
REMINDER_OFFSETS_MIN=15,5

# --- Queue behaviour ---
EMAIL_QUEUE_CONCURRENCY=5
EMAIL_MAX_ATTEMPTS=5
```

Also create `.env.docker` with the Docker hostnames:
`DATABASE_URL=postgresql://postgres:postgres@postgres:5432/notification_db`, `REDIS_URL=redis://redis:6379`, `ROOM_SERVICE_URL=http://room-service:4003`, `SMTP_HOST=mailpit`.

### 11.2.5 File: `services/notification-service/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 4006
# Run pending migrations, then start the compiled server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

> If recording-service's Dockerfile differs (for example, a multi-stage build), copy its pattern.

---

## Step 11.3: Config and utilities

### 11.3.1 File: `src/config/env.ts`

**Why:** Validate environment variables once at boot. If something is missing, the service crashes immediately with a clear message instead of failing at 3 AM.

```ts
import "dotenv/config";
import Joi from "joi";

/**
 * Joi schema describing every environment variable this service needs.
 * Required values have no default, so a missing one aborts startup.
 */
const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(4006),

  JWT_ACCESS_SECRET: Joi.string().min(8).required(),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  ROOM_SERVICE_URL: Joi.string().uri().required(),

  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow("").default(""),
  SMTP_PASS: Joi.string().allow("").default(""),
  MAIL_FROM: Joi.string().required(),

  FRONTEND_URL: Joi.string().uri().required(),
  REMINDER_OFFSETS_MIN: Joi.string().default("15,5"),

  EMAIL_QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(5),
  EMAIL_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
}).unknown(true); // ignore unrelated variables such as PATH

const { value, error } = schema.validate(process.env, { abortEarly: false });

if (error) {
  // Print every problem at once so you can fix them in one go.
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

/**
 * Parse "15,5" into [15, 5], sorted largest first, positive numbers only.
 *
 * @param raw Comma-separated minutes string from the environment.
 * @returns Array of minutes before the meeting at which to send reminders.
 */
function parseOffsets(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
}

/** Typed, validated configuration used everywhere else in the service. */
export const env = {
  nodeEnv: value.NODE_ENV as string,
  isProd: value.NODE_ENV === "production",
  port: value.PORT as number,

  jwtAccessSecret: value.JWT_ACCESS_SECRET as string,
  databaseUrl: value.DATABASE_URL as string,
  redisUrl: value.REDIS_URL as string,
  roomServiceUrl: value.ROOM_SERVICE_URL as string,

  smtp: {
    host: value.SMTP_HOST as string,
    port: value.SMTP_PORT as number,
    secure: value.SMTP_SECURE as boolean,
    user: value.SMTP_USER as string,
    pass: value.SMTP_PASS as string,
  },
  mailFrom: value.MAIL_FROM as string,

  frontendUrl: (value.FRONTEND_URL as string).replace(/\/$/, ""),
  reminderOffsetsMin: parseOffsets(value.REMINDER_OFFSETS_MIN as string),

  emailQueueConcurrency: value.EMAIL_QUEUE_CONCURRENCY as number,
  emailMaxAttempts: value.EMAIL_MAX_ATTEMPTS as number,
};
```

### 11.3.2 File: `src/config/prisma.ts`

**Why:** One shared Prisma client for the whole process. **(A1)** Match the import path to recording-service's `src/config/prisma.ts`.

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "./env";

/**
 * Prisma 7 requires a driver adapter. PrismaPg talks to Postgres through
 * the standard `pg` driver using the DATABASE_URL connection string.
 */
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

/** Shared Prisma client. Import this instead of creating new clients. */
export const prisma = new PrismaClient({ adapter });
```

### 11.3.3 File: `src/config/redis.ts`

**Why:** BullMQ and Pub/Sub need **separate** Redis connections. A connection in subscribe mode cannot run normal commands, and BullMQ requires `maxRetriesPerRequest: null`.

```ts
import { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "../utils/logger";

/**
 * Create a new Redis connection.
 *
 * @param name Label used in logs so you can tell connections apart.
 * @param forBullMQ When true, sets `maxRetriesPerRequest: null`, which BullMQ requires.
 * @returns A connected ioredis client.
 */
export function createRedis(name: string, forBullMQ = false): Redis {
  const client = new Redis(env.redisUrl, {
    maxRetriesPerRequest: forBullMQ ? null : 3,
    enableReadyCheck: true,
  });

  client.on("error", (err) => logger.error({ err, name }, "Redis error"));
  client.on("ready", () => logger.info({ name }, "Redis ready"));
  return client;
}

/** Connection used by the BullMQ Queue (producer side). */
export const queueRedis = createRedis("bullmq-queue", true);

/** Plain connection for health checks and ad-hoc commands. */
export const redis = createRedis("general");
```

### 11.3.4 File: `src/config/roomServiceClient.ts`

**Why:** Ask room-service "who is the host of this room, and when does it start?" We forward the **user's own token**, so room-service applies its normal permission rules and we never need a service-to-service secret.

```ts
import axios from "axios";
import { env } from "./env";
import { AppError } from "../utils/AppError";

/** Subset of the room object this service cares about. */
export interface RoomInfo {
  code: string;
  title: string | null;
  hostId: string; // (A3) rename if your field is called ownerId / createdBy
  scheduledAt: string | null; // ISO string or null for instant rooms
  status?: string;
}

const http = axios.create({
  baseURL: env.roomServiceUrl,
  timeout: 5000,
});

/**
 * Fetch a room from room-service using the caller's access token.
 *
 * @param roomCode Human-readable room code, for example "abc-defg-hij".
 * @param bearerToken Raw JWT (without the "Bearer " prefix).
 * @returns Room details used for host verification and reminder scheduling.
 * @throws AppError 404 if the room does not exist, 502 on other upstream failures.
 */
export async function fetchRoom(roomCode: string, bearerToken: string): Promise<RoomInfo> {
  try {
    const res = await http.get(`/v1/rooms/${encodeURIComponent(roomCode)}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const room = res.data?.data?.room; // (A3) adjust if your response shape differs
    if (!room) throw new AppError("Unexpected room-service response", 502);
    return room as RoomInfo;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err.response?.status === 404) throw new AppError("Room not found", 404);
    if (err.response?.status === 403) throw new AppError("You do not have access to this room", 403);
    throw new AppError("Room service unavailable", 502);
  }
}
```

### 11.3.5 File: `src/utils/logger.ts`

```ts
import pino from "pino";
import { env } from "../config/env";

/** Structured JSON logger. Pretty printing is left to `| pino-pretty` in dev. */
export const logger = pino({
  level: env.isProd ? "info" : "debug",
  base: { service: "notification-service" },
});
```

> Circular import warning: `logger.ts` imports `env.ts`, and `redis.ts` imports both. That is fine because `env.ts` imports nothing from the project.

### 11.3.6 File: `src/utils/AppError.ts`

```ts
/**
 * Error with an HTTP status code. The global error handler turns it into a
 * clean JSON response. Anything that is NOT an AppError becomes a generic 500.
 */
export class AppError extends Error {
  public readonly statusCode: number;

  /**
   * @param message Safe, user-facing message.
   * @param statusCode HTTP status to return (default 500).
   */
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
```

### 11.3.7 File: `src/utils/asyncHandler.ts`

```ts
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wrap an async route handler so rejected promises reach the error middleware.
 * Without this, a thrown error inside `async` code would hang the request.
 *
 * @param fn Async Express handler.
 * @returns A standard Express handler that forwards errors to `next`.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
```

### 11.3.8 File: `types/express/index.d.ts`

```ts
declare global {
  namespace Express {
    interface Request {
      /** Set by authGuard after the JWT is verified. */
      userId?: string;
      /** Raw access token, kept so we can forward it to room-service. */
      accessToken?: string;
    }
  }
}
export {};
```

---

## Step 11.4: Prisma schema and migration

### What and why

One table, `Notification`, is the source of truth for every email: queued, sent, failed or cancelled. The queue (Redis) is transient, so the database is what you query to answer "did the reminder go out?"

### 11.4.1 File: `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}

/// INVITE   = sent immediately when the host invites someone.
/// REMINDER = sent later, shortly before the scheduled meeting time.
enum NotificationType {
  INVITE
  REMINDER
}

/// Lifecycle: PENDING -> SENT | FAILED | CANCELLED
enum NotificationStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}

model Notification {
  id             String             @id @default(uuid())
  type           NotificationType
  status         NotificationStatus @default(PENDING)

  recipientEmail String
  roomCode       String
  roomTitle      String?
  hostName       String?
  message        String?            /// optional personal note from the host

  /// When the meeting starts (null for instant rooms).
  meetingAt      DateTime?
  /// When this email should be delivered.
  sendAt         DateTime

  /// BullMQ job id. Unique, so repeating the same invite cannot create duplicates.
  jobId          String             @unique
  attempts       Int                @default(0)
  lastError      String?
  sentAt         DateTime?

  createdBy      String             /// userId of the host who triggered it
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  @@index([roomCode, status])
  @@index([status, sendAt])
}
```

### 11.4.2 File: `prisma.config.ts`

Copy `recording-service/prisma.config.ts` and keep it identical. Typical shape:

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL! },
});
```

### 11.4.3 Run the migration

```bash
cd services/notification-service
npx prisma migrate dev --name init
```

**Done when:** `prisma/migrations/<timestamp>_init/migration.sql` exists and `notification_db` has a `Notification` table.

---

## Step 11.5: Middleware and validation

### 11.5.1 File: `src/middleware/authGuard.ts`

**Why:** The gateway already checks the token, but every service re-verifies locally (your documented pattern). We also store the raw token so we can forward it to room-service.

```ts
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

/**
 * Verify the `Authorization: Bearer <jwt>` header.
 * On success sets `req.userId` and `req.accessToken`.
 *
 * @throws AppError 401 when the header is missing or the token is invalid/expired.
 */
export function authGuard(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("Missing bearer token", 401));
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as jwt.JwtPayload;
    const userId = (payload.userId ?? payload.sub) as string | undefined; // (A2)
    if (!userId) return next(new AppError("Invalid token payload", 401));

    req.userId = userId;
    req.accessToken = token;
    next();
  } catch {
    next(new AppError("Invalid or expired token", 401));
  }
}
```

### 11.5.2 File: `src/middleware/validate.ts`

```ts
import type { NextFunction, Request, Response } from "express";
import type { ObjectSchema } from "joi";
import { AppError } from "../utils/AppError";

/**
 * Build a middleware that validates `req.body` against a Joi schema.
 * Unknown keys are stripped and values are normalised (trimmed, lower-cased...).
 *
 * @param schema Joi schema describing the allowed body.
 * @returns Express middleware that replaces `req.body` with the cleaned value.
 * @throws AppError 400 listing every validation problem.
 */
export function validateBody(schema: ObjectSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { value, error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return next(new AppError(error.details.map((d) => d.message).join("; "), 400));
    }
    req.body = value;
    next();
  };
}
```

### 11.5.3 File: `src/middleware/errorHandler.ts`

```ts
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger";

/**
 * 404 handler for unknown routes. Mount it AFTER all routes.
 */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("Route not found", 404));
}

/**
 * Global error handler. Mount it LAST.
 * Known AppErrors keep their message and status. Anything else is logged
 * in full but returned to the client as a generic 500 (no stack leaks).
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    success: false,
    message: env.isProd ? "Internal server error" : String((err as Error)?.message ?? err),
  });
}
```

### 11.5.4 File: `src/validation/notificationSchemas.ts`

```ts
import Joi from "joi";

/**
 * Body of POST /v1/notifications/invites.
 *
 * - roomCode: the room the invitees are being invited to.
 * - emails:   1 to 50 addresses (duplicates are removed later).
 * - message:  optional personal note shown in the email (max 500 chars).
 * - hostName: optional display name shown as "X invited you".
 */
export const inviteSchema = Joi.object({
  roomCode: Joi.string().trim().min(3).max(64).required(),
  emails: Joi.array()
    .items(Joi.string().trim().lowercase().email({ tlds: { allow: false } }))
    .min(1)
    .max(50)
    .required(),
  message: Joi.string().trim().max(500).allow("").optional(),
  hostName: Joi.string().trim().max(80).allow("").optional(),
});
```

---

## Step 11.6: Email sending (SMTP and templates)

### 11.6.1 File: `src/email/transporter.ts`

**Why:** Create the SMTP connection once and reuse it. `pool: true` keeps connections open, which is much faster than reconnecting per email.

```ts
import nodemailer from "nodemailer";
import { env } from "../config/env";

/**
 * Shared Nodemailer transporter.
 * In dev (Mailpit) there is no auth, so `auth` is left undefined.
 */
export const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure, // true for port 465, false for 587/1025
  pool: true,
  maxConnections: 5,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

/**
 * Verify that the SMTP server is reachable. Used by the /ready endpoint.
 *
 * @returns true if the SMTP handshake succeeds, false otherwise.
 */
export async function smtpIsReady(): Promise<boolean> {
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}
```

### 11.6.2 File: `src/email/templates.ts`

**Why:** Keep email text out of the business logic. Every template returns a subject, plain text (for clients that block HTML) and HTML. User-supplied text is **HTML-escaped** to prevent injected markup in emails.

```ts
import { env } from "../config/env";

/** Shape returned by every template. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Data both templates need. */
export interface EmailContext {
  roomCode: string;
  roomTitle?: string | null;
  hostName?: string | null;
  message?: string | null;
  meetingAt?: Date | null;
  /** For reminders: minutes until the meeting starts. */
  minutesBefore?: number;
}

/**
 * Escape characters that have special meaning in HTML.
 *
 * @param s Untrusted text (title, host name, personal message).
 * @returns Text that is safe to embed inside HTML.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "'");
}

/**
 * Build the join link placed in every email.
 *
 * @param roomCode Room code, URL-encoded for safety.
 * @returns Absolute URL, for example http://localhost:5173/room/abc-defg-hij.
 */
export function joinUrl(roomCode: string): string {
  return `${env.frontendUrl}/room/${encodeURIComponent(roomCode)}`;
}

/**
 * Format a date as a readable UTC string. (A later improvement is storing the
 * recipient's timezone. UTC is explicit and never wrong.)
 *
 * @param d Meeting start time.
 * @returns For example "Mon, 26 Oct 2026, 14:30 UTC".
 */
function formatWhen(d: Date): string {
  return (
    d.toLocaleString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

/**
 * Shared HTML layout so both emails look consistent.
 *
 * @param heading Large title at the top.
 * @param bodyHtml Inner HTML (already escaped by the caller).
 * @param url Join link used for the button.
 * @param buttonLabel Text on the button.
 */
function layout(heading: string, bodyHtml: string, url: string, buttonLabel: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
    <tr><td>
      <h2 style="margin:0 0 16px;color:#202124;">${heading}</h2>
      ${bodyHtml}
      <p style="margin:24px 0;">
        <a href="${url}" style="background:#1a73e8;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">${buttonLabel}</a>
      </p>
      <p style="color:#5f6368;font-size:12px;">Or paste this link into your browser:<br>${url}</p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Render the invitation email.
 *
 * @param ctx Room and host details.
 * @returns Subject, text and HTML bodies.
 */
export function renderInvite(ctx: EmailContext): RenderedEmail {
  const title = ctx.roomTitle?.trim() || `Room ${ctx.roomCode}`;
  const host = ctx.hostName?.trim() || "Someone";
  const url = joinUrl(ctx.roomCode);
  const when = ctx.meetingAt ? formatWhen(ctx.meetingAt) : "now (open the link any time)";

  const subject = `${host} invited you to "${title}"`;

  const text = [
    `${host} invited you to join "${title}".`,
    `When: ${when}`,
    ctx.message ? `\nMessage: ${ctx.message}` : "",
    `\nJoin: ${url}`,
  ].join("\n");

  const html = layout(
    "You are invited",
    `<p style="color:#3c4043;"><b>${esc(host)}</b> invited you to <b>${esc(title)}</b>.</p>
     <p style="color:#3c4043;">When: <b>${esc(when)}</b></p>
     ${ctx.message ? `<p style="color:#3c4043;border-left:3px solid #dadce0;padding-left:12px;">${esc(ctx.message)}</p>` : ""}`,
    url,
    "Join meeting",
  );

  return { subject, text, html };
}

/**
 * Render the reminder email.
 *
 * @param ctx Room details plus `minutesBefore` and `meetingAt`.
 * @returns Subject, text and HTML bodies.
 */
export function renderReminder(ctx: EmailContext): RenderedEmail {
  const title = ctx.roomTitle?.trim() || `Room ${ctx.roomCode}`;
  const url = joinUrl(ctx.roomCode);
  const mins = ctx.minutesBefore ?? 5;
  const when = ctx.meetingAt ? formatWhen(ctx.meetingAt) : "soon";

  const subject = `Reminder: "${title}" starts in ${mins} minutes`;

  const text = `"${title}" starts in ${mins} minutes (${when}).\n\nJoin: ${url}`;

  const html = layout(
    `Starting in ${mins} minutes`,
    `<p style="color:#3c4043;"><b>${esc(title)}</b> starts at <b>${esc(when)}</b>.</p>`,
    url,
    "Join meeting",
  );

  return { subject, text, html };
}
```

### 11.6.3 File: `src/email/sendEmail.ts`

```ts
import { env } from "../config/env";
import { transporter } from "./transporter";
import type { RenderedEmail } from "./templates";

/**
 * Send one email through the shared SMTP transporter.
 * Throws on failure so the BullMQ worker can retry the job.
 *
 * @param to Recipient address.
 * @param email Rendered subject/text/html.
 * @returns The SMTP message id (useful for logs).
 */
export async function sendEmail(to: string, email: RenderedEmail): Promise<string> {
  const info = await transporter.sendMail({
    from: env.mailFrom,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return info.messageId;
}
```

---

## Step 11.7: BullMQ queue and worker

### What and why

- **Queue (`queues.ts`)**: where jobs wait. Reminder jobs are added with a `delay`, and BullMQ holds them in Redis until the time arrives.
- **Worker (`emailWorker.ts`)**: pulls jobs and sends the email. It first reloads the row from the database. If the row is no longer `PENDING` (cancelled, already sent), it **skips**. This makes the worker **idempotent** and makes cancellation safe even if removing the job from Redis failed.
- **Retries**: 5 attempts with exponential backoff (10s, 20s, 40s, 80s...). Only after the last failure is the row marked `FAILED`.

### 11.7.1 File: `src/queue/queues.ts`

```ts
import { Queue } from "bullmq";
import { env } from "../config/env";
import { queueRedis } from "../config/redis";

/** Name shared by the queue and the worker. */
export const EMAIL_QUEUE_NAME = "notification-email";

/** Payload stored in each job. Only the DB id, so the DB stays the source of truth. */
export interface EmailJobData {
  notificationId: string;
}

/**
 * The email queue (producer side).
 *
 * Default job options:
 *  - attempts + exponential backoff: transient SMTP failures retry automatically.
 *  - removeOnComplete/removeOnFail: keep Redis small; history lives in Postgres.
 */
export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: env.emailMaxAttempts,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
```

### 11.7.2 File: `src/queue/emailWorker.ts`

```ts
import { Worker, type Job } from "bullmq";
import { env } from "../config/env";
import { createRedis } from "../config/redis";
import { prisma } from "../config/prisma";
import { sendEmail } from "../email/sendEmail";
import { renderInvite, renderReminder } from "../email/templates";
import { logger } from "../utils/logger";
import { EMAIL_QUEUE_NAME, type EmailJobData } from "./queues";

/**
 * Process one email job.
 *
 * Steps:
 *  1. Load the Notification row.
 *  2. Skip if it is missing or no longer PENDING (cancelled / already sent).
 *  3. Render the correct template and send it.
 *  4. Mark the row SENT.
 *
 * Any thrown error makes BullMQ retry according to the queue's backoff.
 *
 * @param job BullMQ job containing the notification id.
 */
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const row = await prisma.notification.findUnique({ where: { id: job.data.notificationId } });

  if (!row) {
    logger.warn({ jobId: job.id }, "Notification row missing, skipping");
    return;
  }
  if (row.status !== "PENDING") {
    logger.info({ id: row.id, status: row.status }, "Notification not pending, skipping");
    return;
  }

  // Count this attempt before sending so failures are visible in the DB.
  await prisma.notification.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
  });

  const ctx = {
    roomCode: row.roomCode,
    roomTitle: row.roomTitle,
    hostName: row.hostName,
    message: row.message,
    meetingAt: row.meetingAt,
    minutesBefore:
      row.type === "REMINDER" && row.meetingAt
        ? Math.max(1, Math.round((row.meetingAt.getTime() - row.sendAt.getTime()) / 60000))
        : undefined,
  };

  const email = row.type === "INVITE" ? renderInvite(ctx) : renderReminder(ctx);
  const messageId = await sendEmail(row.recipientEmail, email);

  await prisma.notification.update({
    where: { id: row.id },
    data: { status: "SENT", sentAt: new Date(), lastError: null },
  });

  logger.info({ id: row.id, type: row.type, messageId }, "Email sent");
}

/**
 * Start the email worker. Call once at boot.
 *
 * @returns The BullMQ Worker so the caller can close it on shutdown.
 */
export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: createRedis("bullmq-worker", true),
    concurrency: env.emailQueueConcurrency,
  });

  // Called after EVERY failed attempt. Record the error text each time.
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade >= maxAttempts;

    logger.warn(
      { notificationId: job.data.notificationId, attempt: job.attemptsMade, maxAttempts, err: err.message },
      "Email job failed",
    );

    await prisma.notification
      .update({
        where: { id: job.data.notificationId },
        data: { lastError: err.message.slice(0, 500), ...(isFinal ? { status: "FAILED" } : {}) },
      })
      .catch((e) => logger.error({ e }, "Could not record failure"));
  });

  worker.on("error", (err) => logger.error({ err }, "Worker error"));
  return worker;
}
```

---

## Step 11.8: Business logic

### 11.8.1 File: `src/services/notificationService.ts`

**Why:** Controllers stay thin. All real decisions live here, which makes them reusable (HTTP and Redis subscriber) and easy to test.

**Key ideas**

- **Deterministic job ids** such as `invite_<room>_<email>` and `rem_<room>_<minutes>_<email>`. Re-sending the same invite or rescheduling cannot create duplicates.
- **BullMQ job ids cannot contain `:`**, so we use underscores.
- **Reminders only if still in the future.** If the meeting is in 10 minutes, the 15-minute reminder is skipped.

```ts
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { emailQueue } from "../queue/queues";
import { logger } from "../utils/logger";
import type { RoomInfo } from "../config/roomServiceClient";

/** Input for creating invites. */
export interface InviteInput {
  room: RoomInfo;
  emails: string[];
  hostId: string;
  hostName?: string;
  message?: string;
}

/** What the API returns to the caller. */
export interface InviteResult {
  invited: string[];
  remindersScheduled: number;
}

/**
 * Remove duplicate addresses (case-insensitive) while keeping order.
 *
 * @param emails Raw list from the request.
 * @returns Unique, lower-cased addresses.
 */
function dedupe(emails: string[]): string[] {
  return [...new Set(emails.map((e) => e.toLowerCase()))];
}

/**
 * Create one Notification row and enqueue its BullMQ job.
 * Safe to call twice with the same jobId: the unique constraint on `jobId`
 * means the second call finds the existing row and does nothing.
 *
 * @returns true if a new notification was created, false if it already existed.
 */
async function createAndEnqueue(params: {
  type: "INVITE" | "REMINDER";
  jobId: string;
  email: string;
  room: RoomInfo;
  hostId: string;
  hostName?: string;
  message?: string;
  meetingAt: Date | null;
  sendAt: Date;
}): Promise<boolean> {
  const existing = await prisma.notification.findUnique({ where: { jobId: params.jobId } });
  if (existing) return false;

  const row = await prisma.notification.create({
    data: {
      type: params.type,
      recipientEmail: params.email,
      roomCode: params.room.code,
      roomTitle: params.room.title,
      hostName: params.hostName,
      message: params.message,
      meetingAt: params.meetingAt,
      sendAt: params.sendAt,
      jobId: params.jobId,
      createdBy: params.hostId,
    },
  });

  const delay = Math.max(0, params.sendAt.getTime() - Date.now());
  await emailQueue.add("send-email", { notificationId: row.id }, { jobId: params.jobId, delay });
  return true;
}

/**
 * Create invitation emails (sent immediately) and, for scheduled rooms,
 * reminder emails (delayed).
 *
 * @param input Room, recipients and host details.
 * @returns Which addresses were invited and how many reminders were scheduled.
 */
export async function createInvites(input: InviteInput): Promise<InviteResult> {
  const { room, hostId, hostName, message } = input;
  const emails = dedupe(input.emails);
  const meetingAt = room.scheduledAt ? new Date(room.scheduledAt) : null;
  const now = Date.now();

  let remindersScheduled = 0;

  for (const email of emails) {
    // 1) Invitation: always sent right away.
    await createAndEnqueue({
      type: "INVITE",
      jobId: `invite_${room.code}_${email}`,
      email,
      room,
      hostId,
      hostName,
      message,
      meetingAt,
      sendAt: new Date(now),
    });

    // 2) Reminders: only for scheduled rooms, and only if still in the future.
    if (meetingAt) {
      for (const minutes of env.reminderOffsetsMin) {
        const sendAt = new Date(meetingAt.getTime() - minutes * 60_000);
        if (sendAt.getTime() <= now) continue; // too late for this reminder

        const created = await createAndEnqueue({
          type: "REMINDER",
          jobId: `rem_${room.code}_${minutes}_${email}`,
          email,
          room,
          hostId,
          hostName,
          meetingAt,
          sendAt,
        });
        if (created) remindersScheduled++;
      }
    }
  }

  logger.info({ room: room.code, invited: emails.length, remindersScheduled }, "Invites created");
  return { invited: emails, remindersScheduled };
}

/**
 * Cancel every pending REMINDER for a room (used when the room ends or is
 * cancelled). Two layers of safety:
 *  - Remove the delayed job from Redis so it never fires.
 *  - Mark the DB row CANCELLED so the worker skips it even if removal failed.
 *
 * @param roomCode Room whose reminders should stop.
 * @returns Number of reminders cancelled.
 */
export async function cancelRemindersForRoom(roomCode: string): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { roomCode, type: "REMINDER", status: "PENDING" },
    select: { id: true, jobId: true },
  });

  for (const n of pending) {
    // Removing a job that already ran or does not exist is harmless.
    await emailQueue.remove(n.jobId).catch(() => undefined);
  }

  const { count } = await prisma.notification.updateMany({
    where: { id: { in: pending.map((p) => p.id) }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  logger.info({ roomCode, cancelled: count }, "Reminders cancelled");
  return count;
}
```

---

## Step 11.9: HTTP API (controllers, routes, app, server)

### 11.9.1 File: `src/controllers/inviteController.ts`

```ts
import type { Request, Response } from "express";
import { fetchRoom } from "../config/roomServiceClient";
import { createInvites } from "../services/notificationService";
import { AppError } from "../utils/AppError";

/**
 * POST /v1/notifications/invites
 *
 * Flow:
 *  1. Ask room-service for the room (proves it exists and the caller can see it).
 *  2. Make sure the caller is the HOST. Only hosts may invite.
 *  3. Refuse if the room already ended.
 *  4. Create the invites (and reminders for scheduled rooms).
 *
 * Responds 202 Accepted: emails are queued, not yet delivered.
 */
export async function createInviteController(req: Request, res: Response): Promise<void> {
  const { roomCode, emails, message, hostName } = req.body as {
    roomCode: string;
    emails: string[];
    message?: string;
    hostName?: string;
  };

  const room = await fetchRoom(roomCode, req.accessToken!);

  if (room.hostId !== req.userId) {
    throw new AppError("Only the host can send invitations", 403);
  }
  if (room.status && room.status.toLowerCase() === "ended") {
    throw new AppError("This room has already ended", 409);
  }

  const result = await createInvites({
    room,
    emails,
    hostId: req.userId!,
    hostName: hostName || undefined,
    message: message || undefined,
  });

  res.status(202).json({ success: true, data: result });
}
```

### 11.9.2 File: `src/controllers/healthController.ts`

```ts
import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { smtpIsReady } from "../email/transporter";

/**
 * GET /health: liveness. Answers "is the process running?". No dependencies,
 * so Kubernetes does not restart the pod because a database is slow.
 */
export function health(_req: Request, res: Response): void {
  res.json({ status: "ok" });
}

/**
 * GET /ready: readiness. Answers "can it serve traffic right now?".
 * Checks Postgres, Redis and SMTP and returns 503 if any is down.
 */
export async function ready(_req: Request, res: Response): Promise<void> {
  const checks = {
    postgres: await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis: await redis.ping().then((r) => r === "PONG").catch(() => false),
    smtp: await smtpIsReady(),
  };
  const ok = Object.values(checks).every(Boolean);
  res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "not_ready", checks });
}
```

### 11.9.3 File: `src/routes/notificationRoutes.ts`

```ts
import { Router } from "express";
import { createInviteController } from "../controllers/inviteController";
import { authGuard } from "../middleware/authGuard";
import { validateBody } from "../middleware/validate";
import { inviteSchema } from "../validation/notificationSchemas";
import { asyncHandler } from "../utils/asyncHandler";

/** Mounted at `/v1/notifications` in app.ts. */
export const notificationRoutes = Router();

// POST /v1/notifications/invites
notificationRoutes.post(
  "/invites",
  authGuard,
  validateBody(inviteSchema),
  asyncHandler(createInviteController),
);
```

### 11.9.4 File: `src/app.ts`

```ts
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { health, ready } from "./controllers/healthController";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { notificationRoutes } from "./routes/notificationRoutes";
import { logger } from "./utils/logger";
import { asyncHandler } from "./utils/asyncHandler";

/**
 * Build the Express application (no listening here, so it can be tested).
 *
 * @returns Configured Express app.
 */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "100kb" })); // invites are small
  app.use(pinoHttp({ logger }));

  app.get("/health", health);
  app.get("/ready", asyncHandler(async (req, res) => ready(req, res)));

  app.use("/v1/notifications", notificationRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
```

### 11.9.5 File: `server.ts`

```ts
import { createApp } from "./src/app";
import { env } from "./src/config/env";
import { prisma } from "./src/config/prisma";
import { queueRedis, redis } from "./src/config/redis";
import { emailQueue } from "./src/queue/queues";
import { startEmailWorker } from "./src/queue/emailWorker";
import { startRoomEventsSubscriber } from "./src/subscribers/roomEventsSubscriber";
import { logger } from "./src/utils/logger";

/**
 * Boot sequence:
 *  1. Start the HTTP server.
 *  2. Start the email worker (consumes the queue).
 *  3. Start the Redis subscriber (reacts to room events).
 *  4. Register graceful shutdown so in-flight emails finish.
 */
async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(env.port, () => logger.info({ port: env.port }, "notification-service listening"));

  const worker = startEmailWorker();
  const subscriber = startRoomEventsSubscriber();

  /**
   * Graceful shutdown: stop accepting work, let running jobs finish, close
   * connections, then exit. Triggered by Docker/Kubernetes with SIGTERM.
   */
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Shutting down");
    server.close();
    await worker.close();      // waits for active jobs
    await emailQueue.close();
    subscriber.disconnect();
    queueRedis.disconnect();
    redis.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
```

---

## Step 11.10: Room-service changes

### What and why

The notification service must know **when** a room is scheduled and be told when a room **ends**. Room-service therefore needs (a) a `scheduledAt` column and (b) a small Redis publisher. This is the only change to an existing service in this phase.

### 11.10.1 Install

```bash
cd services/room-service
npm install ioredis
```

### 11.10.2 File: `services/room-service/prisma/schema.prisma` (add one field to `Room`)

```prisma
model Room {
  // ... existing fields ...

  /// When the meeting is planned to start. null = instant room.
  scheduledAt DateTime?
}
```

```bash
npx prisma migrate dev --name add_scheduled_at
```

### 11.10.3 File: `services/room-service/src/config/redis.ts` (new)

```ts
import { Redis } from "ioredis";
import { env } from "./env";

/** Redis connection used only for publishing events. */
export const redisPub = new Redis(env.redisUrl);
```

Add `REDIS_URL` to room-service's `env.ts`, `.env.example` and `.env.docker` (same value as the other services) and add `redis` to its `depends_on` in compose.

### 11.10.4 File: `services/room-service/src/events/publisher.ts` (new)

```ts
import { redisPub } from "../config/redis";

/** Channel every service interested in room lifecycle subscribes to. */
export const ROOM_EVENTS_CHANNEL = "room-events";

/**
 * Publish a room lifecycle event. Failures are swallowed on purpose: a Redis
 * hiccup must never make "end meeting" or "create meeting" fail for the user.
 *
 * @param type Event name, for example "room-ended".
 * @param payload Extra data; `roomCode` is always required.
 */
export async function publishRoomEvent(
  type: "room-ended",
  payload: { roomCode: string },
): Promise<void> {
  try {
    await redisPub.publish(ROOM_EVENTS_CHANNEL, JSON.stringify({ type, ...payload, at: new Date().toISOString() }));
  } catch (err) {
    console.error("Failed to publish room event", err);
  }
}
```

### 11.10.5 Edit `createRoomController.ts`: accept and store `scheduledAt`

```ts
// 1) In validation/roomSchemas.ts, add to the create-room schema:
//      scheduledAt: Joi.date().iso().greater("now").optional()
//
// 2) In the controller, include it when creating the room inside the transaction:
//      data: { ..., scheduledAt: req.body.scheduledAt ?? null }
```

### 11.10.6 Edit `endRoomController.ts`: publish after the DB commit

```ts
import { publishRoomEvent } from "../events/publisher";

// ... after the transaction that marks the room ended succeeds:
await publishRoomEvent("room-ended", { roomCode: room.code });
```

> Publish **after** the commit, never inside the transaction, so subscribers never hear about a change that later rolled back.

### 11.10.7 Make sure `GET /v1/rooms/:code` returns `scheduledAt`, `hostId`, `title` and `status`

If your controller uses `select`, add the fields. This is what `fetchRoom()` (assumption A3) relies on.

---

## Step 11.11: Redis subscriber (cancel reminders when a room ends)

### 11.11.1 File: `src/subscribers/roomEventsSubscriber.ts`

```ts
import type { Redis } from "ioredis";
import { createRedis } from "../config/redis";
import { cancelRemindersForRoom } from "../services/notificationService";
import { logger } from "../utils/logger";

/** Must match ROOM_EVENTS_CHANNEL in room-service. */
const ROOM_EVENTS_CHANNEL = "room-events";

/**
 * Subscribe to room lifecycle events.
 *
 * Uses a DEDICATED connection: once a Redis connection subscribes it can no
 * longer run normal commands.
 *
 * Handled events:
 *  - "room-ended": cancel all pending reminders for that room.
 *
 * @returns The subscriber connection, so the caller can disconnect on shutdown.
 */
export function startRoomEventsSubscriber(): Redis {
  const sub = createRedis("room-events-subscriber");

  sub.subscribe(ROOM_EVENTS_CHANNEL, (err) => {
    if (err) logger.error({ err }, "Failed to subscribe to room-events");
    else logger.info("Subscribed to room-events");
  });

  sub.on("message", async (_channel, raw) => {
    try {
      const evt = JSON.parse(raw) as { type?: string; roomCode?: string };
      if (evt.type === "room-ended" && evt.roomCode) {
        await cancelRemindersForRoom(evt.roomCode);
      }
    } catch (err) {
      // A malformed message must never crash the subscriber.
      logger.warn({ err, raw }, "Ignoring bad room event");
    }
  });

  return sub;
}
```

---

## Step 11.12: Gateway proxy

### File: `services/api-gateway/src/routes/proxyRoutes.ts` (add)

Follow the exact pattern you used for `/v1/rooms`. Same options (`fixRequestBody`, `gatewayAuth`).

```ts
/**
 * Notification service proxy.
 * Client URL : POST /api/v1/notifications/invites
 * Forwarded  : POST /v1/notifications/invites  (path unchanged, like rooms)
 * Protected by gatewayAuth (JWT verified at the edge).
 */
router.use(
  "/v1/notifications",
  gatewayAuth,
  createProxyMiddleware({
    target: env.NOTIFICATION_SERVICE_URL, // e.g. http://notification-service:4006
    changeOrigin: true,
    pathRewrite: { "^/v1/notifications": "/v1/notifications" },
    on: { proxyReq: fixRequestBody },
  }),
);
```

Also add `NOTIFICATION_SERVICE_URL` to the gateway's `env.ts`, `.env.example` and `.env.docker`. This is a good moment to also fix the missing keys the status doc flagged (`JWT_ACCESS_SECRET`, `CHAT_SERVICE_URL`).

---

## Step 11.13: End-to-end test script

### File: `services/notification-service/scripts/e2e-notification.mjs`

**What it proves:** signup/login, then a scheduled room, then an invite, then the email appears in Mailpit, then a reminder job is queued, then ending the room cancels it.

Requires Node 20 (built-in `fetch`). Run: `node scripts/e2e-notification.mjs`

```js
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:4000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/**
 * Small fetch wrapper that throws on non-2xx so the script fails loudly.
 *
 * @param {string} url Full URL.
 * @param {RequestInit & { token?: string, json?: unknown }} opts Request options.
 * @returns {Promise<any>} Parsed JSON response.
 */
async function api(url, { token, json, ...opts } = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${url} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

/**
 * Poll Mailpit until a message to `to` arrives (or time out).
 *
 * @param {string} to Recipient address to look for.
 * @param {number} timeoutMs Give up after this many milliseconds.
 * @returns {Promise<any>} The matching Mailpit message summary.
 */
async function waitForMail(to, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { messages = [] } = await api(`${MAILPIT}/api/v1/messages`);
    const hit = messages.find((m) => m.To?.some((t) => t.Address === to));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to} within ${timeoutMs}ms`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
}

async function main() {
  const stamp = Date.now();
  const host = { email: `host${stamp}@example.com`, password: "password123" };
  const guest = `guest${stamp}@example.com`;

  console.log("1. Clear Mailpit");
  await api(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  console.log("2. Signup + login host");
  await api(`${GATEWAY}/api/auth/signup`, { method: "POST", json: host });
  const login = await api(`${GATEWAY}/api/auth/login`, { method: "POST", json: host });
  const token = login.data.accessToken;

  console.log("3. Create scheduled room (20 minutes from now)");
  const scheduledAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const created = await api(`${GATEWAY}/api/v1/rooms`, {
    method: "POST", token, json: { title: "E2E Standup", scheduledAt },
  });
  const code = created.data.room.code;
  assert(Boolean(code), `room created (${code})`);

  console.log("4. Non-host cannot invite");
  const other = { email: `other${stamp}@example.com`, password: "password123" };
  await api(`${GATEWAY}/api/auth/signup`, { method: "POST", json: other });
  const otherLogin = await api(`${GATEWAY}/api/auth/login`, { method: "POST", json: other });
  let denied = false;
  try {
    await api(`${GATEWAY}/api/v1/notifications/invites`, {
      method: "POST", token: otherLogin.data.accessToken, json: { roomCode: code, emails: [guest] },
    });
  } catch (e) { denied = /403|404/.test(String(e)); }
  assert(denied, "non-host is rejected (403/404)");

  console.log("5. Host sends invite");
  const inv = await api(`${GATEWAY}/api/v1/notifications/invites`, {
    method: "POST", token, json: { roomCode: code, emails: [guest, guest.toUpperCase()], hostName: "E2E Host" },
  });
  assert(inv.data.invited.length === 1, "duplicate emails collapsed to one");
  assert(inv.data.remindersScheduled === 2, "two reminders scheduled (15 and 5 min)");

  console.log("6. Invite email arrives in Mailpit");
  const mail = await waitForMail(guest);
  assert(/invited you/.test(mail.Subject), `subject ok: "${mail.Subject}"`);

  console.log("7. Re-sending the same invite does not duplicate reminders");
  const again = await api(`${GATEWAY}/api/v1/notifications/invites`, {
    method: "POST", token, json: { roomCode: code, emails: [guest] },
  });
  assert(again.data.remindersScheduled === 0, "no duplicate reminders");

  console.log("8. End room cancels reminders");
  await api(`${GATEWAY}/api/v1/rooms/${code}/end`, { method: "POST", token });
  console.log("   (verify in DB: SELECT status FROM \"Notification\" WHERE \"roomCode\"='" + code + "';)");

  console.log("\nALL CHECKS PASSED");
}

main().catch((e) => { console.error("\nE2E FAILED:", e.message); process.exit(1); });
```

---

## Step 11.14: Verification checklist

Run top to bottom. Every box should pass before you call Phase 11 done.

- [ ] `docker compose up --build -d` starts `notification-service` and `mailpit`
- [ ] `GET http://localhost:4006/health` returns `{ "status": "ok" }`
- [ ] `GET http://localhost:4006/ready` returns 200 with `postgres`, `redis`, `smtp` all `true`
- [ ] `POST /api/v1/notifications/invites` **without** a token returns 401
- [ ] Same call as a **non-host** returns 403
- [ ] Same call as host returns **202**, and the email shows in Mailpit (`http://localhost:8025`)
- [ ] Sending the same invite twice creates **no duplicate** rows
- [ ] For a room scheduled 20 min ahead, **2 reminder rows** exist with `status = PENDING`
- [ ] Ending the room changes those rows to `CANCELLED` and no reminder email is ever sent
- [ ] Stop Mailpit, send an invite: the row shows `attempts` increasing, then `FAILED` after 5 tries. Start Mailpit before the final attempt and it becomes `SENT`
- [ ] `node scripts/e2e-notification.mjs` prints `ALL CHECKS PASSED`

### Quick way to test reminders without waiting 15 minutes

Temporarily set `REMINDER_OFFSETS_MIN=1` and create a room scheduled about 2 minutes ahead. The reminder arrives about 1 minute later.

### Useful SQL

```sql
-- Everything for one room
SELECT type, status, "recipientEmail", attempts, "sendAt", "lastError"
FROM "Notification" WHERE "roomCode" = 'YOUR-CODE' ORDER BY "createdAt";

-- Anything stuck or failing
SELECT * FROM "Notification" WHERE status = 'FAILED';
```

---

## Troubleshooting

| Symptom                                       | Likely cause                                           | Fix                                                                     |
| --------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `Invalid environment configuration` at boot | Missing variable                                       | Compare `.env` with `.env.example`                                  |
| `/ready` shows `smtp: false`              | Mailpit not running or wrong `SMTP_HOST`             | In Docker use `mailpit`, locally `localhost`                        |
| BullMQ error about `maxRetriesPerRequest`   | Redis connection created without `forBullMQ = true`  | Use `createRedis(name, true)`                                         |
| `Custom Ids cannot contain :`               | A job id contains a colon                              | Use underscores (this guide already does)                               |
| Invite returns 502                            | `ROOM_SERVICE_URL` wrong or response shape differs   | Check assumption A3 and `fetchRoom()`                                 |
| Invite returns 403 for the real host          | Field name mismatch (`hostId`) or JWT field (A2)     | Log `room.hostId` and `req.userId` and compare                      |
| Reminders never fire                          | Worker not started or Redis flushed                    | Check the `Subscribed...` and worker logs; confirm delayed jobs exist |
| Reminders still sent after room ended         | `room-ended` not published or subscriber not running | `redis-cli SUBSCRIBE room-events`, then end a room                    |
| `notification_db does not exist`            | Init script ran before the DB was added                | Create the DB manually (see 11.1.1)                                     |

---

## Definition of Done for Phase 11

1. All boxes in the verification checklist are ticked.
2. `STEP.MD` status table: Phase 11 changed to ✅ COMPLETED with a short summary.
3. README updated: port 4006, `/api/v1/notifications` route, `room-events` Redis channel, Mailpit.
4. Commit and tag: `git tag v0.11-notifications`.

**Next:** Phase 12, Gateway Hardening (rate limiting, centralized errors, request IDs).
