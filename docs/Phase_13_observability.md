
# Phase 13 — Observability (Metrics, Dashboards, Tracing)

> **Service:** All 9 backend services (`api-gateway`, `auth-service`, `user-service`, `room-service`, `signaling-service`, `chat-service`, `sfu-service`, `recording-service`, `notification-service`) + 3 new infra containers (`prometheus`, `grafana`, `jaeger`)
> **Ports:** Prometheus `9090`, Grafana `3001` (host) → `3000` (container), Jaeger UI `16686`, Jaeger OTLP/HTTP `4318` (Docker network only). Every service exposes `GET /metrics` on its **existing** port (4000–4008).
> **Database:** None new. Prometheus keeps a time-series volume (`prometheus_data`), Grafana keeps `grafana_data`.
> **Tech:** `prom-client`, OpenTelemetry Node SDK (OTLP/HTTP), Prometheus, Grafana, Jaeger all-in-one, Pino (already installed)
> **Depends on:** Phase 0 (Docker Compose), Phase 1–12 (all services exist), Phase 12 (gateway `x-request-id`, `/health`, `/ready`, Redis rate limiting)
> **Result:** You can open one Grafana dashboard and see the health, traffic, errors, and speed of every service, click one slow request and follow it across services in Jaeger, and get alert rules that fire when something breaks.

---

## Table of Contents

- [x] [A. Problems we are solving](#a-problems-we-are-solving)
- [x] [0. Read this first](#0-read-this-first)
- [x] [Final folder structure](#final-folder-structure)
- [x] [Step 13.1 — Install packages](#step-131--install-packages)
- [x] [Step 13.2 — Observability config (fail-fast env)](#step-132--observability-config-fail-fast-env)
- [x] [Step 13.3 — Metrics module](#step-133--metrics-module)
- [x] [Step 13.4 — Tracing bootstrap](#step-134--tracing-bootstrap)
- [x] [Step 13.5 — Log correlation helper](#step-135--log-correlation-helper)
- [x] [Step 13.6 — Copy the shared files into every service](#step-136--copy-the-shared-files-into-every-service)
- [x] [Step 13.7 — Wire metrics + tracing into each Express service](#step-137--wire-metrics--tracing-into-each-express-service)
- [x] [Step 13.8 — API Gateway specifics](#step-138--api-gateway-specifics)
- [x] [Step 13.9 — Signaling Service metrics](#step-139--signaling-service-metrics)
- [x] [Step 13.10 — SFU Service metrics](#step-1310--sfu-service-metrics)
- [x] [Step 13.11 — BullMQ queue metrics (Recording + Notification)](#step-1311--bullmq-queue-metrics-recording--notification)
- [x] [Step 13.12 — Prometheus config and alert rules](#step-1312--prometheus-config-and-alert-rules)
- [x] [Step 13.13 — Grafana provisioning and dashboard](#step-1313--grafana-provisioning-and-dashboard)
- [x] [Step 13.14 — Docker and docker-compose](#step-1314--docker-and-docker-compose)
- [x] [Step 13.15 — E2E test script](#step-1315--e2e-test-script)
- [x] [Verification checklist](#verification-checklist)
- [x] [Troubleshooting](#troubleshooting)
- [x] [Update the docs after it passes](#update-the-docs-after-it-passes)
- [x] [Next](#next)

---

## A. Problems we are solving

| #  | Problem today                                                              | What can go wrong (real example)                                                                              | How this phase fixes it                                                                                                         | Step              |
| -- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1  | Only Pino logs exist. There are no numbers over time.                      | Users say "calls feel slow". You grep nine log streams and cannot tell if it started 5 minutes or 5 days ago. | Every service exposes Prometheus metrics (request rate, errors, latency, memory, event-loop lag).                               | 13.3, 13.7        |
| 2  | A request crosses Gateway → Auth → Redis, but each log line is separate. | Login takes 4 seconds. You cannot tell if the Gateway, Auth, bcrypt, or Postgres is slow.                     | OpenTelemetry tracing: one trace ID follows the request through all services.                                                   | 13.4, 13.7        |
| 3  | Logs and traces are not linked.                                            | You find a trace but cannot find its log lines (or the other way round).                                      | Pino adds `trace_id` and `span_id` to every log line.                                                                       | 13.5              |
| 4  | Nobody is told when a service dies.                                        | `chat-service` crashes at night. Messages are lost until someone notices.                                   | Prometheus alert rules (`ServiceDown`, `High5xxRate`, …) visible in Prometheus and Grafana.                                | 13.12             |
| 5  | Real-time parts are invisible.                                             | Signaling sockets leak, or the SFU has 200 consumers on one worker and nobody knows.                          | Custom gauges: connected sockets, SFU workers/routers/transports/producers/consumers.                                           | 13.9, 13.10       |
| 6  | Background queues fail silently.                                           | Invite emails pile up in BullMQ because SMTP is down. Recording MP4 jobs fail but the API still says 202.     | `bullmq_jobs{queue,state}` gauge plus email result counters.                                                                  | 13.11             |
| 7  | Gateway protection (rate limits, 502/504 trap) is invisible.               | An attacker triggers thousands of 429s, or a service is down and the Gateway returns 502 all day.             | `gateway_rate_limit_hits_total` and `gateway_proxy_errors_total`.                                                           | 13.8              |
| 8  | `/metrics` can leak internals if left open.                              | Anyone on the internet reads route names, memory use, and queue sizes.                                        | Bearer `METRICS_TOKEN` (required in production), compared in constant time, Prometheus/Grafana/Jaeger bound to `127.0.0.1`. | 13.2, 13.3, 13.14 |
| 9  | Metrics can explode memory (high cardinality).                             | A label with a room code or user ID creates a new time series per request and kills Prometheus.               | Route labels use the route **pattern** (`/v1/rooms/:code`), never the real URL. Gateway uses a fixed prefix list.       | 13.3, 13.8        |
| 10 | Nothing proves the setup works.                                            | You deploy and only discover broken scraping during an incident.                                              | E2E script checks scraping, auth, traces, dashboards, and a real failure (stop `chat-service`).                               | 13.15             |

**In one sentence:** this phase turns nine "black box" services into services you can measure, trace, and get alerted about, without changing any business logic.

---

## 0. Read this first

### 0.1 What this phase builds

- A shared **observability module** (4 small files) copied into every service:
  - `config.ts` — validates env variables at startup and fails fast.
  - `metrics.ts` — Prometheus registry, HTTP timing middleware, protected `/metrics` handler.
  - `tracing.ts` — OpenTelemetry SDK that exports traces to Jaeger.
  - `logContext.ts` — adds `trace_id` / `span_id` to Pino logs.
- **Custom metrics** for the Gateway, Signaling, SFU, Recording, and Notification services.
- **Prometheus** (scrapes every service every 15 s, evaluates alert rules).
- **Grafana** (auto-provisioned data sources and one dashboard: `Video Meet — Overview`).
- **Jaeger** (trace storage and UI).
- An **E2E script** `scripts\e2e-observability.mjs`.

**Out of scope (on purpose):** log shipping (Loki/ELK), Alertmanager notifications (email/Slack), long-term metric storage, and Kubernetes ServiceMonitors. Those belong with Phase 15 (Kubernetes). Alert rules are written now so Phase 15 can reuse them.

### 0.2 Assumptions table

I could only read your three attached documents (STEP.MD, the status report, and the README), not your source code. Anything not in those files is an assumption.

| #  | Assumption                                                                                                                                  | Where I checked                                                                                                                                                                                             |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Service ports: gateway 4000, auth 4001, user 4002, room 4003, signaling 4004, chat 4005, sfu 4006, recording 4007, notification 4008        | README service table                                                                                                                                                                                        |
| 2  | Compose service names equal folder names (for example `api-gateway`, `chat-service`) and a Redis service named `redis` exists         | STEP.MD Phase 11/12 (`http://notification-service:4008`, `redis` dependency)                                                                                                                            |
| 3  | All services use TypeScript, ESM, and `.js` import endings; Express 5 in the Gateway                                                      | STEP.MD Phase 12, README ("tsx watch server.ts")                                                                                                                                                            |
| 4  | `server.ts` is in the **service root** and `app.ts` is in `src/`                                                                | README dev command (`tsx watch server.ts`), STEP.MD (`src/app.ts`, `server.ts`). If your `server.ts` is inside `src/`, change `./src/observability/...` to `./observability/...` in Step 13.7 |
| 5  | Every service has an Express `app` with `/health` (signaling and SFU too)                                                               | STEP.MD Phase 0 ("All microservices expose `/health`")                                                                                                                                                    |
| 6  | Pino is already used (`pino-http` in the Gateway). Other services may use a `logger.ts`                                                 | STEP.MD Phase 1, 11                                                                                                                                                                                         |
| 7  | JSON error shape is `{ success: false, error: { code, message }, requestId }` and success is `{ success: true, data }`                  | README manual tests (`.data.accessToken`), STEP.MD Phase 12 (`requestId`). **If your shape differs, edit only `sendMetricsError` in Step 13.3**                                                 |
| 8  | Host ports 4000–4008 are published by `docker-compose.yml` (needed only by the E2E script)                                               | README manual test uses `localhost:4000`; others assumed                                                                                                                                                  |
| 9  | Node 22 in Docker (Gateway uses `node:22-alpine`); local Node is 20.6 or newer                                                            | STEP.MD Phase 12                                                                                                                                                                                            |
| 10 | Host port `3000` is used by `test-client` (`npx serve`), so Grafana uses host port `3001`                                           | Status report "How to Run"                                                                                                                                                                                  |
| 11 | BullMQ queue objects are exported from `src/queues/...` in recording and notification services; you will pass them in Step 13.11          | STEP.MD Phase 10.6 (`queues.ts`), 11.7 (`emailQueue`)                                                                                                                                                   |
| 12 | SFU keeps workers, routers, transports, producers, consumers in in-memory Maps/arrays; you will give a small "stats" function in Step 13.10 | STEP.MD Phase 9                                                                                                                                                                                             |
| 13 | `shared/` exists at repo root (README folder tree) and is not used by Docker builds (each service builds from its own folder)             | README folder tree                                                                                                                                                                                          |

**Library versions and Node requirements (verify with `npm view <pkg> version engines` before installing):**

| Package                                       | Needs                                      | Note                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prom-client`                               | Node 16 or newer                           | Use v15 or newer. Default metrics include `nodejs_eventloop_lag_*`.                                                                                  |
| `@opentelemetry/sdk-node` (2.x line)        | Node 18.19 or newer, or Node 20.6 or newer | **Must be v2 or newer** together with `@opentelemetry/exporter-trace-otlp-http` v0.200 or newer. Mixing v1 and v2 packages causes type errors. |
| `@opentelemetry/auto-instrumentations-node` | Node 18.19 or newer                        | Install it at the same time as `sdk-node` so peer ranges match.                                                                                      |
| `@opentelemetry/api`                        | Node 8 or newer                            | v1.9 or newer.                                                                                                                                         |
| Prometheus                                    | image `prom/prometheus:v3.5.0`           | Prometheus 3.x changed some defaults (UTF-8 names). Our names are plain, so it is safe.                                                                |
| Grafana                                       | image `grafana/grafana:12.0.2`           | Provisioning format below works on 10.x–12.x.                                                                                                         |
| Jaeger                                        | image `jaegertracing/all-in-one:1.62.0`  | OTLP is enabled by default in this line.                                                                                                               |

### 0.3 Architecture / request-flow diagram

```mermaid
flowchart LR
    subgraph Services["Backend services (each has /metrics + OTel SDK)"]
        GW["api-gateway :4000"]
        AUTH["auth-service :4001"]
        USER["user-service :4002"]
        ROOM["room-service :4003"]
        SIG["signaling-service :4004"]
        CHAT["chat-service :4005"]
        SFU["sfu-service :4006"]
        REC["recording-service :4007"]
        NOTIF["notification-service :4008"]
    end

    PROM["Prometheus :9090<br/>scrape every 15s + alert rules"]
    GRAF["Grafana :3001<br/>dashboard"]
    JAEG["Jaeger :16686<br/>OTLP :4318"]
    YOU["You (browser)"]

    PROM -- "GET /metrics (Bearer token)" --> Services
    Services -- "OTLP/HTTP traces" --> JAEG
    GRAF -- "PromQL" --> PROM
    GRAF -- "trace lookup" --> JAEG
    YOU --> GRAF
    YOU --> JAEG
    YOU --> PROM
```

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as api-gateway
    participant A as auth-service
    participant P as Prometheus
    participant J as Jaeger

    C->>GW: POST /api/auth/login
    Note over GW: OTel starts trace T1<br/>http_request_duration_seconds timer starts
    GW->>A: proxied request + traceparent header
    Note over A: OTel continues trace T1 (child span)
    A-->>GW: 200
    GW-->>C: 200
    Note over GW,A: Both services record the duration in their own histogram
    GW-->>J: spans (batched)
    A-->>J: spans (batched)
    P->>GW: GET /metrics (every 15s)
    P->>A: GET /metrics (every 15s)
```

**Why this order?**

1. **Code first, infrastructure second.** The shared module compiles on its own, so you can test one service before touching Docker.
2. **One service first, then all.** You prove `/metrics` works in `auth-service`, then copy the pattern to the rest. A mistake is fixed once, not nine times.
3. **Custom metrics after generic metrics.** Gateway, Signaling, SFU, and queue metrics are small additions on top of a working base.
4. **Prometheus before Grafana.** Grafana only shows what Prometheus stores. If Prometheus targets are not "UP", dashboards stay empty.
5. **E2E last.** It tests the whole chain, including a deliberate failure.

### 0.4 Build order table

| Step  | What                                  | Files touched                                                                                                         |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 13.1  | Install npm packages in every service | `package.json` ×9                                                                                                  |
| 13.2  | Config with fail-fast validation      | `shared\observability\config.ts` (NEW)                                                                              |
| 13.3  | Metrics module                        | `shared\observability\metrics.ts` (NEW)                                                                             |
| 13.4  | Tracing bootstrap                     | `shared\observability\tracing.ts` (NEW)                                                                             |
| 13.5  | Log correlation helper                | `shared\observability\logContext.ts` (NEW)                                                                          |
| 13.6  | Copy shared files to every service    | `services\*\src\observability\*` (NEW)                                                                              |
| 13.7  | Wire into Express services            | `server.ts`, `src\app.ts`, logger, `.env.docker` per service                                                    |
| 13.8  | Gateway custom metrics                | `api-gateway\src\observability\gatewayMetrics.ts` (NEW), `app.ts`, `createServiceProxy.ts`, `rateLimiters.ts` |
| 13.9  | Signaling metrics                     | `signaling-service\src\observability\signalingMetrics.ts` (NEW), `server.ts`                                      |
| 13.10 | SFU metrics                           | `sfu-service\src\observability\sfuMetrics.ts` (NEW), `server.ts`                                                  |
| 13.11 | Queue metrics                         | `queueMetrics.ts` (NEW, recording + notification), `emailWorker.ts`                                               |
| 13.12 | Prometheus config + alerts            | `infra\prometheus\prometheus.yml`, `alerts.yml`, `metrics_token` (NEW)                                          |
| 13.13 | Grafana provisioning + dashboard      | `infra\grafana\...` (NEW)                                                                                           |
| 13.14 | Compose, env files                    | `docker-compose.yml`, `infra\observability.env`, `.env`                                                         |
| 13.15 | E2E script                            | `scripts\e2e-observability.mjs` (NEW)                                                                               |

---

## Final folder structure

```
GOOGLE_MEET/
├── docker-compose.yml                          # CHANGED  (+prometheus, grafana, jaeger, env_file on 9 services)
├── .env                                        # NEW      (GRAFANA_ADMIN_PASSWORD) - do NOT commit
├── .gitignore                                  # CHANGED  (+ .env, infra/prometheus/metrics_token)
├── infra/
│   ├── coturn/turnserver.conf                  # same
│   ├── postgres-init/                          # same
│   ├── observability.env                       # NEW      (shared METRICS_TOKEN + OTEL settings) - do NOT commit
│   ├── prometheus/
│   │   ├── prometheus.yml                      # NEW
│   │   ├── alerts.yml                          # NEW
│   │   └── metrics_token                       # NEW      (same value as METRICS_TOKEN) - do NOT commit
│   └── grafana/
│       ├── provisioning/
│       │   ├── datasources/datasources.yml     # NEW
│       │   └── dashboards/dashboards.yml       # NEW
│       └── dashboards/video-meet-overview.json # NEW
├── shared/
│   └── observability/                          # NEW      (single source of truth, copied to services)
│       ├── config.ts
│       ├── metrics.ts
│       ├── tracing.ts
│       └── logContext.ts
├── scripts/
│   └── e2e-observability.mjs                   # NEW
└── services/
    ├── api-gateway/
    │   ├── server.ts                           # CHANGED  (first-line tracing import)
    │   └── src/
    │       ├── app.ts                          # CHANGED  (metrics middleware + /metrics)
    │       ├── observability/                  # NEW      (4 shared files + gatewayMetrics.ts)
    │       ├── proxy/createServiceProxy.ts     # CHANGED  (count 502/504)
    │       └── middleware/rateLimiters.ts      # CHANGED  (count 429)
    ├── auth-service/        (server.ts CHANGED, src/app.ts CHANGED, src/observability/ NEW)
    ├── user-service/        (same pattern)
    ├── room-service/        (same pattern)
    ├── chat-service/        (same pattern)
    ├── signaling-service/   (same pattern + signalingMetrics.ts)
    ├── sfu-service/         (same pattern + sfuMetrics.ts)
    ├── recording-service/   (same pattern + queueMetrics.ts)
    └── notification-service/ (same pattern + queueMetrics.ts, emailWorker.ts CHANGED)
```

---

## Step 13.1 — Install packages

**What and why:** Each service is its own npm project (own `package.json`, own Docker build), so each one needs its own copy of the libraries. We install the **same** five packages everywhere so versions never drift.

Open PowerShell at the repo root (`GOOGLE_MEET`):

```powershell
node --version   # must be v20.6.0 or newer

$services = 'api-gateway','auth-service','user-service','room-service','signaling-service','chat-service','sfu-service','recording-service','notification-service'

# Optional: check the real current versions and Node requirements first
npm view prom-client version engines
npm view @opentelemetry/sdk-node version engines

foreach ($s in $services) {
  Write-Host "=== $s ===" -ForegroundColor Cyan
  Push-Location "services\$s"
  npm install prom-client @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
  Pop-Location
}
```

> **Version warning:** if `npm install` prints `ERESOLVE` about `@opentelemetry/*`, one of your services pins an older OpenTelemetry package. Fix it by running `npm ls @opentelemetry/api` in that service and removing the old package. Do **not** use `--force`.

---

## Step 13.2 — Observability config (fail-fast env)

**File:** `shared\observability\config.ts` — **create new**

**What and why:** Problem: if `METRICS_TOKEN` is missing in production, `/metrics` would be open to everyone, and you would not notice. Solution: read and check all observability env variables **once at startup**. If anything is wrong, the service refuses to start with a clear message.

This file has **no dependencies** (no Joi, no dotenv) because it must run *before* everything else, including your normal `env.ts`.

| Variable                        | Required?                     | Default         | Meaning                                             |
| ------------------------------- | ----------------------------- | --------------- | --------------------------------------------------- |
| `OTEL_SERVICE_NAME`           | Yes                           | none            | Name shown in Jaeger (for example `auth-service`) |
| `NODE_ENV`                    | No                            | `development` | `production` makes `METRICS_TOKEN` mandatory    |
| `METRICS_ENABLED`             | No                            | `true`        | Turn `/metrics` on or off                         |
| `METRICS_TOKEN`               | Production: yes (16+ chars)   | none            | Bearer token Prometheus must send                   |
| `OTEL_ENABLED`                | No                            | `false`       | Turn tracing on or off                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Only if `OTEL_ENABLED=true` | none            | For example `http://jaeger:4318`                  |

```ts
// shared/observability/config.ts
// Copied into services/<name>/src/observability/config.ts by Step 13.6.

/**
 * Validated observability settings for one service process.
 */
export interface ObservabilityConfig {
  /** Name used in Jaeger and error messages. */
  serviceName: string;
  /** Runtime environment, for example "development" or "production". */
  nodeEnv: string;
  /** True when GET /metrics should answer. */
  metricsEnabled: boolean;
  /** Bearer token required by GET /metrics, or undefined when no token is set. */
  metricsToken: string | undefined;
  /** True when OpenTelemetry tracing should start. */
  otelEnabled: boolean;
  /** Base URL of the OTLP/HTTP collector, without /v1/traces. */
  otlpEndpoint: string | undefined;
}

/**
 * Reads a true/false environment variable.
 *
 * @param name - environment variable name
 * @param fallback - value used when the variable is missing or empty
 * @returns the parsed boolean
 * @throws {Error} when the value is set but is not exactly "true" or "false"
 */
function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Strict on purpose: "1", "yes" or "True" are easy typos that silently disable security.
  throw new Error(`[observability] ${name} must be "true" or "false" but got "${raw}".`);
}

/**
 * Reads and validates all observability environment variables.
 *
 * @returns a validated, read-only configuration object
 * @throws {Error} when a required variable is missing or has an invalid value
 */
export function loadObservabilityConfig(): ObservabilityConfig {
  const serviceName = (process.env.OTEL_SERVICE_NAME ?? '').trim();
  if (serviceName === '') {
    throw new Error(
      '[observability] OTEL_SERVICE_NAME is required (for example "auth-service"). ' +
        'For local runs start the service with: tsx watch --env-file=.env server.ts',
    );
  }

  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
  const metricsEnabled = readBoolean('METRICS_ENABLED', true);
  const otelEnabled = readBoolean('OTEL_ENABLED', false);

  const rawToken = (process.env.METRICS_TOKEN ?? '').trim();
  const metricsToken = rawToken === '' ? undefined : rawToken;

  // In production an open /metrics endpoint leaks route names, memory use and queue sizes.
  if (nodeEnv === 'production' && metricsEnabled) {
    if (metricsToken === undefined || metricsToken.length < 16) {
      throw new Error(
        '[observability] METRICS_TOKEN must be set and at least 16 characters when NODE_ENV=production ' +
          'and METRICS_ENABLED=true.',
      );
    }
  }

  const rawEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  let otlpEndpoint: string | undefined;
  if (otelEnabled) {
    if (rawEndpoint === '') {
      throw new Error('[observability] OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED=true.');
    }
    try {
      // Remove a trailing slash so we can safely append "/v1/traces" later.
      otlpEndpoint = new URL(rawEndpoint).toString().replace(/\/$/, '');
    } catch {
      throw new Error(`[observability] OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL: "${rawEndpoint}".`);
    }
  }

  return { serviceName, nodeEnv, metricsEnabled, metricsToken, otelEnabled, otlpEndpoint };
}

/** Singleton configuration. Loaded once when the module is first imported. */
export const observabilityConfig: ObservabilityConfig = Object.freeze(loadObservabilityConfig());
```

**Why this design choice:** `Object.freeze` stops other code from changing the token at runtime. The strict `"true"/"false"` rule means a typo crashes at boot instead of quietly leaving `/metrics` open.

---

## Step 13.3 — Metrics module

**File:** `shared\observability\metrics.ts` — **create new**

**What and why:**

Problem: you need request counts, errors, and latency for every route, but you must **not** put real URLs (like `/v1/rooms/AbC123`) in labels. Each different room code would create a new time series (called *high cardinality*) and Prometheus would run out of memory.

Solution: label by the Express **route pattern** (`/v1/rooms/:code`). When no pattern exists (404s, proxies), we use a safe fallback (`unmatched`, or a fixed list for the Gateway).

| Approach                    | Example label        | Problem                       |
| --------------------------- | -------------------- | ----------------------------- |
| Real URL (bad)              | `/v1/rooms/AbC123` | Unlimited values, memory leak |
| Route pattern (good)        | `/v1/rooms/:code`  | Small, fixed set              |
| Fixed prefix list (Gateway) | `/api/v1/rooms`    | Small, fixed set              |

We expose one histogram, `http_request_duration_seconds`. Its `_count` series is the request count, so we do not need a second counter.

The `/metrics` handler:

1. Returns `404` if metrics are disabled.
2. If a token is configured, requires `Authorization: Bearer <token>` and compares in **constant time** (`timingSafeEqual`).
3. Never shows internal errors to the caller.

```ts
// shared/observability/metrics.ts
// Copied into services/<name>/src/observability/metrics.ts by Step 13.6.

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
// prom-client is CommonJS: use the default import, then read members from it.
import client from 'prom-client';
import { observabilityConfig } from './config.js';

/**
 * Options for {@link httpMetricsMiddleware}.
 */
export interface HttpMetricsOptions {
  /**
   * Optional function that turns a request into a SAFE, low-cardinality route label.
   * Return undefined to fall back to the Express route pattern.
   */
  resolveRoute?: (req: Request) => string | undefined;
}

/** One registry per process. We do not use the global registry so tests stay isolated. */
export const register = new client.Registry();

if (observabilityConfig.metricsEnabled) {
  // Gives us process_cpu_*, process_resident_memory_bytes, nodejs_eventloop_lag_*, GC stats, etc.
  client.collectDefaultMetrics({ register });
}

/** Histogram of HTTP request durations. Its _count series doubles as a request counter. */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // Buckets tuned for an API: 5 ms up to 10 s. bcrypt logins land around 0.1-0.3 s.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/** Number of HTTP requests currently being processed. */
export const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  registers: [register],
});

/**
 * Builds the safe route label for a finished request.
 *
 * @param req - the Express request
 * @param options - optional custom resolver
 * @returns a low-cardinality label such as "/v1/rooms/:code" or "unmatched"
 */
function routeLabel(req: Request, options: HttpMetricsOptions): string {
  const custom = options.resolveRoute?.(req);
  if (custom !== undefined) return custom;
  // req.route only exists when a real Express route matched, so 404 scans do not create labels.
  if (req.route && typeof req.route.path === 'string') {
    return `${req.baseUrl ?? ''}${req.route.path}`;
  }
  return 'unmatched';
}

/**
 * Express middleware that measures every request's duration and status code.
 * Mount it early (right after the request-id / logging middleware).
 *
 * @param options - optional route resolver (the Gateway uses this)
 * @returns an Express middleware
 */
export function httpMetricsMiddleware(options: HttpMetricsOptions = {}): RequestHandler {
  return function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Do not measure Prometheus scraping itself.
    if (!observabilityConfig.metricsEnabled || req.path === '/metrics') {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    httpRequestsInFlight.inc();

    let finished = false;
    /**
     * Records the request exactly once, even if both "finish" and "close" fire.
     *
     * @returns nothing
     */
    const record = (): void => {
      if (finished) return;
      finished = true;
      httpRequestsInFlight.dec();
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDuration.observe(
        { method: req.method, route: routeLabel(req, options), status_code: String(res.statusCode) },
        seconds,
      );
    };
    res.on('finish', record);
    // "close" covers clients that disconnect before the response ends (otherwise in-flight would leak).
    res.on('close', record);
    next();
  };
}

/**
 * Compares two strings in constant time to avoid timing attacks on the token.
 *
 * @param provided - value sent by the caller
 * @param expected - the real token
 * @returns true when both strings are identical
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on different lengths. Length is not secret enough to matter here.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sends a JSON error in the project's standard shape without leaking internals.
 *
 * @param req - the Express request (used to echo x-request-id)
 * @param res - the Express response
 * @param status - HTTP status code
 * @param code - short machine-readable error code
 * @param message - safe, human-readable message
 * @returns nothing
 */
function sendMetricsError(req: Request, res: Response, status: number, code: string, message: string): void {
  const requestId = req.headers['x-request-id'] ?? null;
  res.status(status).json({ success: false, error: { code, message }, requestId });
}

/**
 * Express handler for GET /metrics. Mount it BEFORE auth guards and rate limiters.
 *
 * @param req - the Express request
 * @param res - the Express response
 * @returns a promise that resolves when the response is sent
 * @throws {Error} never. All errors are caught and converted to a generic 500.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  if (!observabilityConfig.metricsEnabled) {
    sendMetricsError(req, res, 404, 'NOT_FOUND', 'Not found');
    return;
  }

  const expected = observabilityConfig.metricsToken;
  if (expected !== undefined) {
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!tokenMatches(provided, expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendMetricsError(req, res, 401, 'UNAUTHORIZED', 'Unauthorized');
      return;
    }
  }

  try {
    res.setHeader('Content-Type', register.contentType);
    // Never cache metrics: stale data would confuse Prometheus.
    res.setHeader('Cache-Control', 'no-store');
    res.end(await register.metrics());
  } catch {
    sendMetricsError(req, res, 500, 'INTERNAL_ERROR', 'Could not collect metrics');
  }
}
```

**Why this design choice:** `res.on('close')` matters. Without it, a client that hangs up leaves the "in flight" gauge stuck above zero forever, and your dashboard slowly lies.

---

## Step 13.4 — Tracing bootstrap

**File:** `shared\observability\tracing.ts` — **create new**

**What and why:**

Problem: logs from different services cannot be joined. Solution: **OpenTelemetry (OTel)** adds a `traceparent` header to every outgoing HTTP call and continues it in the next service. Jaeger then shows the whole path as one tree of *spans*.

OTel must patch libraries (`http`, `express`, `pg`, `ioredis`, `mongodb`) **before** they are loaded. That is why this file must be the **very first import** of `server.ts` (Step 13.7). In ESM, imports run in the order written, so first line = first to run.

| Setting                | Our choice                                                         | Why                                                                               |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Exporter               | OTLP over HTTP to Jaeger `:4318`                                 | Simple, no extra tools                                                            |
| Sampling               | `parentbased_traceidratio` via env (`OTEL_TRACES_SAMPLER_ARG`) | Dev = 1.0 (all). Production can use 0.1. The child follows the parent's decision. |
| Ignored URLs           | `/metrics`, `/health`, `/ready`                              | Prometheus and Docker call them constantly; they would flood Jaeger               |
| `fs` instrumentation | Off                                                                | Creates thousands of useless spans                                                |
| Disabled?              | Does nothing                                                       | `OTEL_ENABLED=false` costs zero                                                 |

```ts
// shared/observability/tracing.ts
// Copied into services/<name>/src/observability/tracing.ts by Step 13.6.
// MUST be the first import in server.ts so OpenTelemetry can patch libraries before they load.

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { observabilityConfig } from './config.js';

/** Paths that must never create spans (noise). */
const IGNORED_PATH_PREFIXES = ['/metrics', '/health', '/ready'];

/**
 * Starts the OpenTelemetry SDK when OTEL_ENABLED=true.
 *
 * @returns the started SDK, or undefined when tracing is disabled
 * @throws {Error} never. A tracing failure is logged and the service keeps running.
 */
function startTracing(): NodeSDK | undefined {
  if (!observabilityConfig.otelEnabled || observabilityConfig.otlpEndpoint === undefined) {
    return undefined;
  }

  const sdk = new NodeSDK({
    serviceName: observabilityConfig.serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${observabilityConfig.otlpEndpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) =>
            IGNORED_PATH_PREFIXES.some((prefix) => (req.url ?? '').startsWith(prefix)),
        },
      }),
    ],
  });

  try {
    sdk.start();
  } catch (error) {
    // Observability must never take the product down.
    console.error('[observability] OpenTelemetry failed to start:', error instanceof Error ? error.message : error);
    return undefined;
  }

  /**
   * Flushes pending spans when the process is asked to stop.
   * It does NOT call process.exit, because the service has its own graceful shutdown.
   *
   * @returns a promise that resolves when the flush is done or has failed
   * @throws {Error} never. Errors are swallowed on purpose during shutdown.
   */
  const flush = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch {
      // Ignore: the collector may already be gone.
    }
  };
  process.once('SIGTERM', () => void flush());
  process.once('SIGINT', () => void flush());

  return sdk;
}

/** Exported so tests can check whether tracing started. */
export const tracingSdk: NodeSDK | undefined = startTracing();
```

> **Sampling env (set in Step 13.14):** `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=1.0`. The SDK reads these itself; we do not need code for them.

---

## Step 13.5 — Log correlation helper

**File:** `shared\observability\logContext.ts` — **create new**

**What and why:** Problem: you find a slow trace in Jaeger but cannot find its Pino logs. Solution: Pino has a `mixin` option that adds fields to **every** log line. We add the current `trace_id` and `span_id`, so you can search logs by trace ID.

```ts
// shared/observability/logContext.ts
// Copied into services/<name>/src/observability/logContext.ts by Step 13.6.

import { trace } from '@opentelemetry/api';

/**
 * Pino "mixin" that adds the active trace and span IDs to every log line.
 * Returns an empty object when there is no active span (for example at startup).
 *
 * @returns extra fields to merge into the log line
 * @throws {Error} never.
 */
export function traceMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (span === undefined) return {};
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}
```

### Checkpoint: compile one service first

Do this now in **one** service (`auth-service`) before touching the others.

```powershell
# Step 13.6 explains the copy loop. For this checkpoint copy manually:
New-Item -ItemType Directory -Force services\auth-service\src\observability | Out-Null
Copy-Item shared\observability\*.ts services\auth-service\src\observability\

cd services\auth-service
npx tsc --noEmit
cd ..\..
```

Expected: **0 errors**. If you see `Cannot find module 'prom-client'`, run Step 13.1 again for this service.

---

## Step 13.6 — Copy the shared files into every service

**What and why:** Each Docker image is built from only its own folder (`services\<name>`), so it cannot import from `shared\`. The simplest safe design is: **keep one master copy in `shared\observability\`** and copy it into each service. A small script also detects *drift* (a service whose copy was edited by hand).

**File:** `scripts\sync-observability.ps1` — **create new**

```powershell
# scripts\sync-observability.ps1
# Copies shared\observability\*.ts into every service and reports drift.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\sync-observability.ps1
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\sync-observability.ps1 -CheckOnly

param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$services = 'api-gateway','auth-service','user-service','room-service','signaling-service','chat-service','sfu-service','recording-service','notification-service'
$sharedFiles = Get-ChildItem (Join-Path $root 'shared\observability') -Filter *.ts
$drift = 0

foreach ($s in $services) {
  $target = Join-Path $root "services\$s\src\observability"
  if (-not $CheckOnly) { New-Item -ItemType Directory -Force $target | Out-Null }
  foreach ($f in $sharedFiles) {
    $dest = Join-Path $target $f.Name
    if ($CheckOnly) {
      if (-not (Test-Path $dest) -or (Get-FileHash $f.FullName).Hash -ne (Get-FileHash $dest).Hash) {
        Write-Host "DRIFT: $s\src\observability\$($f.Name)" -ForegroundColor Yellow
        $drift++
      }
    } else {
      Copy-Item $f.FullName $dest -Force
    }
  }
  if (-not $CheckOnly) { Write-Host "synced $s" -ForegroundColor Green }
}

if ($CheckOnly) {
  if ($drift -gt 0) { Write-Host "$drift file(s) differ from shared\observability" -ForegroundColor Red; exit 1 }
  Write-Host 'All copies match shared\observability' -ForegroundColor Green
}
```

Run it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-observability.ps1
powershell -ExecutionPolicy Bypass -File scripts\sync-observability.ps1 -CheckOnly
```

Expected: `synced ...` ×9 then `All copies match shared\observability`.

**Why this design choice:** a copied file is boring but safe: no monorepo tooling, no change to nine Dockerfiles. The `-CheckOnly` mode can run in CI later (Phase 14).

---

## Step 13.7 — Wire metrics + tracing into each Express service

Do this for **auth, user, room, chat, recording, notification** now. Gateway, Signaling, and SFU need the same three edits **plus** the extras in Steps 13.8–13.10.

### 13.7.1 — `server.ts` (CHANGED, edit first line)

**File:** `services\<name>\server.ts` — **add one line at the very top**, above all other imports:

```ts
// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';
```

> If your `server.ts` lives inside `src\`, write `import './observability/tracing.js';` instead (Assumption 4).

### 13.7.2 — `src\app.ts` (CHANGED, add imports + two lines)

Add the import with your other imports:

```ts
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';
```

Add these lines **after** your request-id and pino-http middleware, and **before** auth guards, rate limiters, and routes:

```ts
app.use(httpMetricsMiddleware()); // measures every request
app.get('/metrics', metricsHandler); // protected by METRICS_TOKEN, no JWT needed
```

**Why before auth:** Prometheus has no user JWT. The Bearer **metrics token** is its credential, not a user login.

### 13.7.3 — Logger (CHANGED, one option)

In each service's Pino setup (your `logger.ts`, or the `pino-http` options in the Gateway) add `mixin`:

```ts
import { traceMixin } from '../observability/logContext.js'; // adjust the relative path

// inside pino({ ... })
mixin: traceMixin,
```

For `pino-http` pass it through the `logger` you create, not as a `pino-http` option.

### 13.7.4 — Local dev script (CHANGED, `package.json`)

Tracing loads **before** your own `env.ts`, so `.env` has not been read yet. Make Node read it first (Node 20.6 or newer):

```json
"dev": "tsx watch --env-file=.env server.ts"
```

Add these lines to each service's local `.env` (and `.env.example`):

```env
OTEL_SERVICE_NAME=auth-service
METRICS_ENABLED=true
METRICS_TOKEN=dev-metrics-token-change-me-1234
OTEL_ENABLED=false
```

### 13.7.5 — Compile checkpoint

```powershell
foreach ($s in 'auth-service','user-service','room-service','chat-service','recording-service','notification-service') {
  Write-Host "== $s" -ForegroundColor Cyan
  Push-Location "services\$s"; npx tsc --noEmit; Pop-Location
}
```

Expected: **0 errors** each. Quick local smoke test of one service:

```powershell
cd services\auth-service
npm run dev
# in a second PowerShell window:
curl.exe -i http://localhost:4001/metrics
curl.exe -i -H "Authorization: Bearer dev-metrics-token-change-me-1234" http://localhost:4001/metrics
```

Expected: first call `401`, second call `200` with text starting `# HELP`.

---

## Step 13.8 — API Gateway specifics

**What and why:** The Gateway is a proxy, so Express has no route pattern for proxied requests (`req.route` is empty). If we used the raw URL we would create a new label per room code. We map the URL to a **fixed list of prefixes** instead. We also add two counters that show the Phase 12 protections working: rate-limit hits and upstream failures.

### 13.8.1 — New file `services\api-gateway\src\observability\gatewayMetrics.ts`

```ts
// services/api-gateway/src/observability/gatewayMetrics.ts

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import client from 'prom-client';
import { register } from './metrics.js';

/** Fixed list of public route prefixes. Anything else is labelled "unmatched". */
const KNOWN_PREFIXES = [
  '/api/auth',
  '/api/users',
  '/api/v1/rooms',
  '/api/v1/chat',
  '/api/v1/recordings',
  '/api/v1/notifications',
  '/health',
  '/ready',
] as const;

/** Counts proxy failures (upstream down, timeout) by target service and status. */
export const proxyErrorsTotal = new client.Counter({
  name: 'gateway_proxy_errors_total',
  help: 'Upstream proxy failures turned into 502/504 by the gateway',
  labelNames: ['target', 'status'] as const,
  registers: [register],
});

/** Counts requests rejected by each rate limiter. */
export const rateLimitHitsTotal = new client.Counter({
  name: 'gateway_rate_limit_hits_total',
  help: 'Requests rejected with 429 by the gateway rate limiters',
  labelNames: ['limiter'] as const,
  registers: [register],
});

/**
 * Maps a request URL to a safe, low-cardinality route label.
 *
 * @param req - the Express request
 * @returns a known prefix, or "unmatched"
 * @throws {Error} never.
 */
export function resolveGatewayRoute(req: Request): string {
  const url = req.originalUrl ?? req.url;
  const found = KNOWN_PREFIXES.find((prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`));
  return found ?? 'unmatched';
}

/**
 * Builds a rate-limit "handler" for express-rate-limit that counts the hit and replies with 429.
 * Use it as the `handler` option of each limiter.
 *
 * @param limiterName - short name such as "global", "auth", "refresh", "api", "download"
 * @returns an Express handler that answers 429 in the project's JSON shape
 * @throws {Error} never.
 */
export function rateLimitHandler(limiterName: string): RequestHandler {
  return function onRateLimited(req: Request, res: Response, _next: NextFunction): void {
    rateLimitHitsTotal.inc({ limiter: limiterName });
    const requestId = req.headers['x-request-id'] ?? null;
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
      requestId,
    });
  };
}
```

### 13.8.2 — `src\app.ts` (CHANGED)

Use the resolver in Step 13.7.2's line, and put `/metrics` **before** the global limiter so scrapes are never rate limited:

```ts
import { resolveGatewayRoute } from './observability/gatewayMetrics.js';

app.use(httpMetricsMiddleware({ resolveRoute: resolveGatewayRoute }));
app.get('/metrics', metricsHandler); // BEFORE the global rate limiter
```

### 13.8.3 — `src\proxy\createServiceProxy.ts` (CHANGED)

Where your upstream error trap sends the sanitized 502/504, add one line (use the proxy's name, such as `auth-service`, as `target`):

```ts
import { proxyErrorsTotal } from '../observability/gatewayMetrics.js';

// inside the error handler, right before you send the JSON error:
proxyErrorsTotal.inc({ target: targetName, status: String(statusCode) });
```

`targetName` and `statusCode` are the variables you already use for the service name and for the 502/504 decision. If they have other names, use those.

### 13.8.4 — `src\middleware\rateLimiters.ts` (CHANGED)

In each limiter created with `rateLimit({ ... })`, replace the existing `handler` (or add one) with:

```ts
import { rateLimitHandler } from '../observability/gatewayMetrics.js';

// global limiter:   handler: rateLimitHandler('global'),
// auth limiter:     handler: rateLimitHandler('auth'),
// refresh limiter:  handler: rateLimitHandler('refresh'),
// standard API:     handler: rateLimitHandler('api'),
// download limiter: handler: rateLimitHandler('download'),
```

```powershell
cd services\api-gateway
npx tsc --noEmit   # expect 0 errors
cd ..\..
```

---

## Step 13.9 — Signaling Service metrics

**What and why:** HTTP metrics do not show WebSocket health. A leak (sockets that never disconnect) would stay invisible. We add a gauge of connected sockets and a counter per event name.

**Safety note:** event names come from clients. If we used them as labels directly, an attacker could send random names and create endless series. We only label **known** events; everything else is `other`.

### 13.9.1 — New file `services\signaling-service\src\observability\signalingMetrics.ts`

```ts
// services/signaling-service/src/observability/signalingMetrics.ts

import type { Server } from 'socket.io';
import client from 'prom-client';
import { register } from './metrics.js';

/** Events we are willing to use as label values. Everything else becomes "other". */
const KNOWN_EVENTS = new Set([
  'join-room',
  'leave-room',
  'offer',
  'answer',
  'ice-candidate',
  'chat-message',
]);

/** Number of Socket.io connections currently open. */
export const connectedSockets = new client.Gauge({
  name: 'signaling_connected_sockets',
  help: 'Number of currently connected Socket.io clients',
  registers: [register],
});

/** Total incoming Socket.io events, by (safe) event name. */
export const socketEventsTotal = new client.Counter({
  name: 'signaling_events_total',
  help: 'Incoming Socket.io events',
  labelNames: ['event'] as const,
  registers: [register],
});

/**
 * Attaches metrics to a Socket.io server. Call it once, after the server is created.
 * Note: this runs for connections that passed your socket auth middleware.
 *
 * @param io - the Socket.io server instance
 * @returns nothing
 * @throws {Error} never.
 */
export function instrumentSocketServer(io: Server): void {
  io.on('connection', (socket) => {
    connectedSockets.inc();
    // onAny sees every event without changing your existing handlers.
    socket.onAny((event: string) => {
      socketEventsTotal.inc({ event: KNOWN_EVENTS.has(event) ? event : 'other' });
    });
    socket.on('disconnect', () => connectedSockets.dec());
  });
}
```

### 13.9.2 — `services\signaling-service\server.ts` (CHANGED)

After `const io = new Server(...)` add:

```ts
import { instrumentSocketServer } from './src/observability/signalingMetrics.js';

instrumentSocketServer(io);
```

```powershell
cd services\signaling-service
npx tsc --noEmit
cd ..\..
```

---

## Step 13.10 — SFU Service metrics

**What and why:** The SFU is the most expensive service (CPU, UDP ports 20000–20050). You need to know how many workers, routers, transports, producers, and consumers exist. Problem: I cannot see how your `sfu-service` stores them. Solution: you give **one small function** (`getStats`) that counts your own Maps, and the gauges call it **only when Prometheus scrapes** (`collect`). There is no timer and no extra cost between scrapes.

### 13.10.1 — New file `services\sfu-service\src\observability\sfuMetrics.ts`

```ts
// services/sfu-service/src/observability/sfuMetrics.ts

import client from 'prom-client';
import { register } from './metrics.js';

/**
 * Snapshot of the SFU's in-memory objects.
 */
export interface SfuStats {
  /** Number of mediasoup workers (normally one per CPU core). */
  workers: number;
  /** Number of mediasoup routers (one per active room). */
  routers: number;
  /** Number of WebRTC transports (send + receive). */
  transports: number;
  /** Number of producers (published tracks). */
  producers: number;
  /** Number of consumers (forwarded tracks). */
  consumers: number;
}

/** Function that counts the SFU's current objects. */
export type SfuStatsProvider = () => SfuStats;

/** Provider set by registerSfuStatsProvider. Undefined until the SFU is ready. */
let provider: SfuStatsProvider | undefined;

/**
 * Creates one gauge whose value is read from the provider at scrape time.
 *
 * @param name - Prometheus metric name
 * @param help - help text
 * @param key - which SfuStats field to expose
 * @returns the created gauge
 * @throws {Error} never. A failing provider yields no sample for that scrape.
 */
function makeGauge(name: string, help: string, key: keyof SfuStats): client.Gauge {
  return new client.Gauge({
    name,
    help,
    registers: [register],
    collect() {
      if (provider === undefined) return;
      try {
        this.set(provider()[key]);
      } catch {
        // A broken stats function must not break the whole /metrics response.
      }
    },
  });
}

makeGauge('sfu_workers', 'mediasoup workers', 'workers');
makeGauge('sfu_routers', 'mediasoup routers (active rooms)', 'routers');
makeGauge('sfu_transports', 'mediasoup WebRTC transports', 'transports');
makeGauge('sfu_producers', 'mediasoup producers', 'producers');
makeGauge('sfu_consumers', 'mediasoup consumers', 'consumers');

/**
 * Tells the metrics module how to count the SFU's objects.
 *
 * @param statsProvider - function returning current counts
 * @returns nothing
 * @throws {Error} never.
 */
export function registerSfuStatsProvider(statsProvider: SfuStatsProvider): void {
  provider = statsProvider;
}
```

### 13.10.2 — `services\sfu-service\server.ts` (CHANGED)

After workers and routers are created, register the provider. Replace the right-hand sides with your real Maps/arrays:

```ts
import { registerSfuStatsProvider } from './src/observability/sfuMetrics.js';

registerSfuStatsProvider(() => ({
  workers: workers.length,                 // your array of mediasoup workers
  routers: routers.size,                   // your Map<roomId, Router>
  transports: transports.size,             // your Map of WebRtcTransports
  producers: producers.size,               // your Map of Producers
  consumers: consumers.size,               // your Map of Consumers
}));
```

> **Assumption 12:** if your SFU stores peers as `Map<peerId, { transports, producers, consumers }>`, compute the totals with a loop inside this function. It runs every 15 s only, so a simple loop is fine.

```powershell
cd services\sfu-service
npx tsc --noEmit
cd ..\..
```

---

## Step 13.11 — BullMQ queue metrics (Recording + Notification)

**What and why:** If the SMTP server dies, emails pile up in BullMQ and your API still answers `201`. A gauge of `waiting`, `active`, `delayed`, `failed` jobs makes the problem visible. As with the SFU gauges, counts are fetched only when Prometheus scrapes.

### 13.11.1 — New file (identical in both services)

**File:** `services\recording-service\src\observability\queueMetrics.ts` and `services\notification-service\src\observability\queueMetrics.ts`

```ts
// services/recording-service/src/observability/queueMetrics.ts
// services/notification-service/src/observability/queueMetrics.ts  (same content)

import type { Queue } from 'bullmq';
import client from 'prom-client';
import { register } from './metrics.js';

/** Job states we expose. "completed" is left out: it only grows and is not useful as a gauge. */
const STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** Queues registered for metrics. */
const queues: Queue[] = [];

/** Number of jobs per queue and state, read from Redis at scrape time. */
export const bullmqJobs = new client.Gauge({
  name: 'bullmq_jobs',
  help: 'BullMQ jobs by queue and state',
  labelNames: ['queue', 'state'] as const,
  registers: [register],
  async collect() {
    this.reset(); // remove stale label sets (for example a removed queue)
    for (const queue of queues) {
      try {
        const counts = await queue.getJobCounts(...STATES);
        for (const state of STATES) {
          this.set({ queue: queue.name, state }, counts[state] ?? 0);
        }
      } catch {
        // Redis is down: skip this queue. The ServiceDown / Redis alerts cover that case.
      }
    }
  },
});

/**
 * Registers BullMQ queues so their job counts are exposed on /metrics.
 *
 * @param newQueues - queue objects, for example [emailQueue] or [finalizeQueue, autoStopQueue]
 * @returns nothing
 * @throws {Error} never.
 */
export function registerQueueMetrics(newQueues: Queue[]): void {
  queues.push(...newQueues);
}
```

### 13.11.2 — Register your queues

In **recording-service** `server.ts` (after queues exist; names from your `queues.ts`):

```ts
import { registerQueueMetrics } from './src/observability/queueMetrics.js';
import { finalizeQueue, autoStopQueue } from './src/queues/queues.js'; // use your real export names

registerQueueMetrics([finalizeQueue, autoStopQueue]);
```

In **notification-service** `server.ts`:

```ts
import { registerQueueMetrics } from './src/observability/queueMetrics.js';
import { emailQueue } from './src/queues/emailQueue.js'; // use your real path

registerQueueMetrics([emailQueue]);
```

### 13.11.3 — Count email results (notification-service only)

Add a counter to `queueMetrics.ts`? No: keep it next to the worker. Create `services\notification-service\src\observability\emailMetrics.ts`:

```ts
// services/notification-service/src/observability/emailMetrics.ts

import client from 'prom-client';
import { register } from './metrics.js';

/** Email jobs finished, by job name (invite / reminder) and result. */
export const emailJobsTotal = new client.Counter({
  name: 'notification_email_jobs_total',
  help: 'Email jobs finished by type and result',
  labelNames: ['type', 'result'] as const,
  registers: [register],
});

/**
 * Converts a BullMQ job name to a safe label value.
 *
 * @param jobName - the name of the BullMQ job
 * @returns "invite", "reminder" or "other"
 * @throws {Error} never.
 */
export function emailTypeLabel(jobName: string | undefined): 'invite' | 'reminder' | 'other' {
  const name = (jobName ?? '').toLowerCase();
  if (name.includes('invite')) return 'invite';
  if (name.includes('reminder')) return 'reminder';
  return 'other';
}
```

In `emailWorker.ts`, after the worker is created (variable name `emailWorker` from STEP.MD 11.7), add:

```ts
import { emailJobsTotal, emailTypeLabel } from '../observability/emailMetrics.js';

emailWorker.on('completed', (job) => emailJobsTotal.inc({ type: emailTypeLabel(job.name), result: 'sent' }));
emailWorker.on('failed', (job) => emailJobsTotal.inc({ type: emailTypeLabel(job?.name), result: 'failed' }));
```

Fix the import path to match where your file lives. Compile both services:

```powershell
foreach ($s in 'recording-service','notification-service') { Push-Location "services\$s"; npx tsc --noEmit; Pop-Location }
```

---

## Step 13.12 — Prometheus config and alert rules

**What and why:** Prometheus **pulls** (scrapes) metrics, so it needs a list of targets. All services are on the Docker network, so we use their service names. The token comes from a **file** (`credentials_file`) so it is not written in the YAML.

### 13.12.1 — Create the token file (PowerShell)

Generate one random token and use it in **both** the token file and `infra\observability.env` (Step 13.14):

```powershell
$token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
New-Item -ItemType Directory -Force infra\prometheus | Out-Null
Set-Content -Path infra\prometheus\metrics_token -Value $token -NoNewline   # NoNewline is important
$token   # copy this value for Step 13.14
```

Add to `.gitignore`:

```
.env
infra/observability.env
infra/prometheus/metrics_token
```

### 13.12.2 — `infra\prometheus\prometheus.yml` (create new)

```yaml
# infra/prometheus/prometheus.yml
global:
  scrape_interval: 15s       # how often we pull metrics
  evaluation_interval: 15s   # how often alert rules are checked
  scrape_timeout: 10s

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  - job_name: video-meet
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/metrics_token   # mounted read-only by docker-compose
    static_configs:
      - targets: ['api-gateway:4000']
        labels: { service: api-gateway }
      - targets: ['auth-service:4001']
        labels: { service: auth-service }
      - targets: ['user-service:4002']
        labels: { service: user-service }
      - targets: ['room-service:4003']
        labels: { service: room-service }
      - targets: ['signaling-service:4004']
        labels: { service: signaling-service }
      - targets: ['chat-service:4005']
        labels: { service: chat-service }
      - targets: ['sfu-service:4006']
        labels: { service: sfu-service }
      - targets: ['recording-service:4007']
        labels: { service: recording-service }
      - targets: ['notification-service:4008']
        labels: { service: notification-service }
```

**Why this design choice:** the `service` label comes from Prometheus, **not** from our code. If both set a label with the same name, Prometheus renames ours to `exported_service` and every query becomes confusing.

### 13.12.3 — `infra\prometheus\alerts.yml` (create new)

```yaml
# infra/prometheus/alerts.yml
groups:
  - name: video-meet
    rules:
      - alert: ServiceDown
        expr: up{job="video-meet"} == 0
        for: 1m
        labels: { severity: critical }
        annotations:
          summary: "{{ $labels.service }} is down"
          description: "Prometheus could not scrape {{ $labels.service }} for 1 minute."

      - alert: High5xxRate
        expr: |
          sum by (service) (rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))
            / sum by (service) (rate(http_request_duration_seconds_count[5m])) > 0.05
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "{{ $labels.service }} returns more than 5% 5xx"

      - alert: HighLatencyP95
        expr: |
          histogram_quantile(0.95,
            sum by (service, le) (rate(http_request_duration_seconds_bucket[5m]))) > 1
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "{{ $labels.service }} p95 latency is above 1 second"

      - alert: GatewayUpstreamErrors
        expr: sum by (target) (increase(gateway_proxy_errors_total[5m])) > 5
        for: 2m
        labels: { severity: critical }
        annotations:
          summary: "Gateway cannot reach {{ $labels.target }} (502/504)"

      - alert: QueueBacklog
        expr: bullmq_jobs{state="waiting"} > 100
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "Queue {{ $labels.queue }} has more than 100 waiting jobs"

      - alert: QueueFailedJobs
        expr: bullmq_jobs{state="failed"} > 10
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "Queue {{ $labels.queue }} has more than 10 failed jobs"

      - alert: EventLoopLagHigh
        expr: nodejs_eventloop_lag_p99_seconds > 0.2
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "{{ $labels.service }} event loop is blocked (p99 above 200 ms)"
```

---

## Step 13.13 — Grafana provisioning and dashboard

**What and why:** "Provisioning" means Grafana loads data sources and dashboards from **files** at startup. No clicking, and a fresh `docker compose up` on any machine gives the same result.

### 13.13.1 — `infra\grafana\provisioning\datasources\datasources.yml` (create new)

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus          # fixed uid so the dashboard JSON can refer to it
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
  - name: Jaeger
    uid: jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
    editable: false
```

### 13.13.2 — `infra\grafana\provisioning\dashboards\dashboards.yml` (create new)

```yaml
apiVersion: 1
providers:
  - name: video-meet
    orgId: 1
    type: file
    disableDeletion: true
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
```

### 13.13.3 — `infra\grafana\dashboards\video-meet-overview.json` (create new)

```json
{
  "uid": "video-meet-overview",
  "title": "Video Meet — Overview",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "15s",
  "time": { "from": "now-1h", "to": "now" },
  "tags": ["video-meet"],
  "panels": [
    {
      "id": 1, "type": "stat", "title": "Services UP",
      "gridPos": { "x": 0, "y": 0, "w": 4, "h": 5 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum(up{job=\"video-meet\"})" }]
    },
    {
      "id": 2, "type": "timeseries", "title": "Requests per second (by service)",
      "gridPos": { "x": 4, "y": 0, "w": 10, "h": 5 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "reqps" }, "overrides": [] },
      "targets": [{ "refId": "A", "legendFormat": "{{service}}", "expr": "sum by (service) (rate(http_request_duration_seconds_count[5m]))" }]
    },
    {
      "id": 3, "type": "timeseries", "title": "5xx errors per second (by service)",
      "gridPos": { "x": 14, "y": 0, "w": 10, "h": 5 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "reqps" }, "overrides": [] },
      "targets": [{ "refId": "A", "legendFormat": "{{service}}", "expr": "sum by (service) (rate(http_request_duration_seconds_count{status_code=~\"5..\"}[5m]))" }]
    },
    {
      "id": 4, "type": "timeseries", "title": "p95 latency (by service)",
      "gridPos": { "x": 0, "y": 5, "w": 12, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "targets": [{ "refId": "A", "legendFormat": "{{service}}", "expr": "histogram_quantile(0.95, sum by (service, le) (rate(http_request_duration_seconds_bucket[5m])))" }]
    },
    {
      "id": 5, "type": "timeseries", "title": "Gateway: upstream errors and rate-limit hits",
      "gridPos": { "x": 12, "y": 5, "w": 12, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [
        { "refId": "A", "legendFormat": "502/504 {{target}}", "expr": "sum by (target) (rate(gateway_proxy_errors_total[5m]))" },
        { "refId": "B", "legendFormat": "429 {{limiter}}", "expr": "sum by (limiter) (rate(gateway_rate_limit_hits_total[5m]))" }
      ]
    },
    {
      "id": 6, "type": "timeseries", "title": "Signaling: connected sockets",
      "gridPos": { "x": 0, "y": 12, "w": 8, "h": 6 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "legendFormat": "sockets", "expr": "signaling_connected_sockets" }]
    },
    {
      "id": 7, "type": "timeseries", "title": "SFU: transports / producers / consumers",
      "gridPos": { "x": 8, "y": 12, "w": 8, "h": 6 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [
        { "refId": "A", "legendFormat": "transports", "expr": "sfu_transports" },
        { "refId": "B", "legendFormat": "producers", "expr": "sfu_producers" },
        { "refId": "C", "legendFormat": "consumers", "expr": "sfu_consumers" },
        { "refId": "D", "legendFormat": "rooms", "expr": "sfu_routers" }
      ]
    },
    {
      "id": 8, "type": "timeseries", "title": "BullMQ jobs (by queue and state)",
      "gridPos": { "x": 16, "y": 12, "w": 8, "h": 6 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "legendFormat": "{{queue}} {{state}}", "expr": "sum by (queue, state) (bullmq_jobs)" }]
    },
    {
      "id": 9, "type": "timeseries", "title": "Event loop lag p99 (by service)",
      "gridPos": { "x": 0, "y": 18, "w": 12, "h": 6 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "targets": [{ "refId": "A", "legendFormat": "{{service}}", "expr": "nodejs_eventloop_lag_p99_seconds" }]
    },
    {
      "id": 10, "type": "timeseries", "title": "Memory (RSS) by service",
      "gridPos": { "x": 12, "y": 18, "w": 12, "h": 6 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "bytes" }, "overrides": [] },
      "targets": [{ "refId": "A", "legendFormat": "{{service}}", "expr": "process_resident_memory_bytes" }]
    }
  ]
}
```

---

## Step 13.14 — Docker and docker-compose

### 13.14.1 — Shared env file `infra\observability.env` (create new, not committed)

Use the **same** token you generated in Step 13.12.1:

```env
# infra/observability.env  (do NOT commit)
METRICS_ENABLED=true
METRICS_TOKEN=PASTE_THE_SAME_40_CHAR_TOKEN_HERE
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=1.0
```

Create the root `.env` (read by Compose itself for `${...}`):

```env
GRAFANA_ADMIN_PASSWORD=choose-a-strong-password-here
```

### 13.14.2 — Service Dockerfiles: no change needed

Tracing is imported from code, so there is no `--require` flag and no start command change. Your service Dockerfiles already run `npm ci`; the new packages come from the updated `package-lock.json`. For comparison, this is the Gateway's expected pattern (multi-stage, Node 22, non-root). **Only check yours looks like this; do not replace it blindly:**

```dockerfile
# services/api-gateway/Dockerfile (reference)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

> If `npm ci` fails with "package.json and package-lock.json are not in sync", you forgot to commit the lock file after Step 13.1.

### 13.14.3 — `docker-compose.yml` (CHANGED)

**(a) Add these three services** (under `services:`):

```yaml
  prometheus:
    image: prom/prometheus:v3.5.0
    container_name: prometheus
    restart: unless-stopped
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.retention.time=15d   # keep 15 days, then delete old data
    volumes:
      - ./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./infra/prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
      - ./infra/prometheus/metrics_token:/etc/prometheus/metrics_token:ro
      - prometheus_data:/prometheus
    ports:
      - "127.0.0.1:9090:9090"   # localhost only: Prometheus has no login
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:9090/-/healthy"]
      interval: 15s
      timeout: 5s
      retries: 5

  grafana:
    image: grafana/grafana:12.0.2
    container_name: grafana
    restart: unless-stopped
    depends_on:
      prometheus:
        condition: service_healthy
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?set GRAFANA_ADMIN_PASSWORD in .env}
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_AUTH_ANONYMOUS_ENABLED: "false"
    volumes:
      - ./infra/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./infra/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_data:/var/lib/grafana
    ports:
      - "127.0.0.1:3001:3000"   # 3000 is used by test-client
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5

  jaeger:
    image: jaegertracing/all-in-one:1.62.0
    container_name: jaeger
    restart: unless-stopped
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "127.0.0.1:16686:16686"   # UI. OTLP port 4318 stays inside the Docker network.
    # No healthcheck: the Jaeger image has no shell tools. Services only log a warning if it is down.
```

**(b) Add to the top-level `volumes:` block:**

```yaml
volumes:
  prometheus_data:
  grafana_data:
  # keep your existing volumes (postgres, mongo, recordings_data, ...) here too
```

**(c) For each of the 9 services** add `env_file` (keep your existing one) and its name. Example for `auth-service`:

```yaml
  auth-service:
    env_file:
      - ./services/auth-service/.env.docker
      - ./infra/observability.env
    environment:
      OTEL_SERVICE_NAME: auth-service
```

Repeat with the right `OTEL_SERVICE_NAME` for `api-gateway`, `user-service`, `room-service`, `signaling-service`, `chat-service`, `sfu-service`, `recording-service`, `notification-service`.

> Set `NODE_ENV=production` for the services in your real deployment. Then a missing or short `METRICS_TOKEN` stops the service at boot (Step 13.2).

**Why these settings:**

| Setting                            | Reason                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `127.0.0.1:` before host ports   | Prometheus, Grafana, and Jaeger have weak or no auth. Only your machine can reach them. |
| `${GRAFANA_ADMIN_PASSWORD:?...}` | Compose refuses to start with the default `admin/admin`.                              |
| `retention.time=15d`             | Stops the volume from growing forever.                                                  |
| `:ro` mounts                     | A compromised container cannot rewrite its own config.                                  |
| Jaeger OTLP not published          | Only containers on the Docker network may send traces.                                  |

### 13.14.4 — Build and start

```powershell
cd C:\Users\swaru\OneDrive\Desktop\PROJECT\GOOGLE_MEET
docker compose config --quiet                      # validates YAML and required variables
docker compose up --build -d
docker compose ps
```

Expected: every service `running` and `healthy`; `prometheus` and `grafana` `healthy`.

---

## Step 13.15 — E2E test script

**File:** `scripts\e2e-observability.mjs` — **create new** (Node 20 or newer; uses built-in `fetch`).

**What it tests:**

| Group        | Test                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal       | Every service `/metrics` returns 200 with a token and contains expected metric names                                                                                |
| Security     | `/metrics` returns 401 with no token and with a wrong token                                                                                                         |
| Metrics flow | Real gateway traffic increases the gateway's counters                                                                                                                 |
| Prometheus   | All 9 targets are `up`, and alert rules are loaded                                                                                                                  |
| Tracing      | A login produces one Jaeger trace containing both `api-gateway` and `auth-service`                                                                                |
| Grafana      | Health is OK, both data sources and the dashboard exist                                                                                                               |
| Failure      | Stop `chat-service` → Gateway returns 502/504, `gateway_proxy_errors_total` rises, Prometheus marks target down, alert `ServiceDown` becomes pending or firing |
| Cleanup      | `chat-service` is **always** restarted in `finally` and checked healthy                                                                                     |

**Run it:**

```powershell
$env:METRICS_TOKEN = (Get-Content infra\prometheus\metrics_token -Raw)
$env:GRAFANA_ADMIN_PASSWORD = "your-password-from-.env"
node scripts\e2e-observability.mjs
```

> The script signs up one user and logs in once (2 hits on the strict auth limiter of 10 per 15 minutes). Running it more than about 4 times in 15 minutes can trigger `429`. Wait or restart Redis.

```js
#!/usr/bin/env node
// scripts/e2e-observability.mjs
// End-to-end checks for Phase 13 (metrics, Prometheus, Jaeger, Grafana, failure handling).

import { execFileSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const PROMETHEUS = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const JAEGER = process.env.JAEGER_URL ?? 'http://localhost:16686';
const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:3001';
const METRICS_TOKEN = (process.env.METRICS_TOKEN ?? '').trim();
const GRAFANA_PASSWORD = process.env.GRAFANA_ADMIN_PASSWORD ?? '';

/** Name -> host port. Must match docker-compose.yml published ports. */
const SERVICES = [
  { name: 'api-gateway', port: 4000 },
  { name: 'auth-service', port: 4001 },
  { name: 'user-service', port: 4002 },
  { name: 'room-service', port: 4003 },
  { name: 'signaling-service', port: 4004 },
  { name: 'chat-service', port: 4005 },
  { name: 'sfu-service', port: 4006 },
  { name: 'recording-service', port: 4007 },
  { name: 'notification-service', port: 4008 },
];

const results = [];

/**
 * Pauses for a number of milliseconds.
 *
 * @param {number} ms - milliseconds to wait
 * @returns {Promise<void>} resolves after the delay
 * @throws {Error} never.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one named test, prints PASS or FAIL, and records the result.
 *
 * @param {string} name - test description
 * @param {() => Promise<void>} fn - async test body; throw to fail
 * @returns {Promise<void>} resolves after the result is printed
 * @throws {Error} never. Failures are caught and recorded.
 */
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      -> ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Throws when a condition is false.
 *
 * @param {unknown} condition - value that must be truthy
 * @param {string} message - error message when it is not
 * @returns {void}
 * @throws {Error} when the condition is falsy
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Repeats a check until it returns a truthy value or the time runs out.
 *
 * @param {() => Promise<unknown>} fn - function returning a truthy value on success
 * @param {number} timeoutMs - total time to wait
 * @param {number} intervalMs - delay between attempts
 * @returns {Promise<unknown>} the first truthy value
 * @throws {Error} when the timeout is reached
 */
async function waitFor(fn, timeoutMs, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs} ms${lastError ? ` (last error: ${lastError.message})` : ''}`);
}

/**
 * Fetches a service's metrics text.
 *
 * @param {number} port - host port of the service
 * @param {string | null} token - Bearer token, or null for no Authorization header
 * @returns {Promise<Response>} the raw fetch response
 * @throws {Error} on network failure
 */
function fetchMetrics(port, token) {
  return fetch(`http://localhost:${port}/metrics`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
}

/**
 * Adds up all samples of one metric whose label text contains every given label.
 *
 * @param {string} text - Prometheus exposition text
 * @param {string} name - metric name (exact)
 * @param {Record<string, string>} labels - labels that must be present
 * @returns {number} the sum (0 when nothing matches)
 * @throws {Error} never.
 */
function sumMetric(text, name, labels = {}) {
  let total = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+([0-9.eE+-]+|NaN|\+Inf)$/);
    if (!match || match[1] !== name) continue;
    const labelText = match[3] ?? '';
    if (Object.entries(labels).every(([k, v]) => labelText.includes(`${k}="${v}"`))) total += Number(match[4]);
  }
  return total;
}

/**
 * Reads the Gateway metrics text using the metrics token.
 *
 * @returns {Promise<string>} metrics text
 * @throws {Error} when the response is not 200
 */
async function gatewayMetricsText() {
  const res = await fetchMetrics(4000, METRICS_TOKEN);
  assert(res.status === 200, `gateway /metrics returned ${res.status}`);
  return res.text();
}

/**
 * Sends a JSON request to the Gateway.
 *
 * @param {string} path - path starting with /api
 * @param {{method?: string, token?: string, body?: unknown}} options - request options
 * @returns {Promise<{status: number, json: any}>} status and parsed JSON (null if not JSON)
 * @throws {Error} on network failure
 */
async function gw(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON: keep null.
  }
  return { status: res.status, json };
}

/**
 * Runs a docker compose command from the repository root.
 *
 * @param {string[]} args - arguments after "docker compose"
 * @returns {void}
 * @throws {Error} when the command fails
 */
function compose(args) {
  execFileSync('docker', ['compose', ...args], { stdio: 'pipe', cwd: new URL('..', import.meta.url) });
}

/**
 * Fetches Prometheus active targets keyed by service label.
 *
 * @returns {Promise<Record<string, string>>} map of service -> health ("up" / "down" / "unknown")
 * @throws {Error} when Prometheus is unreachable
 */
async function prometheusTargets() {
  const res = await fetch(`${PROMETHEUS}/api/v1/targets?state=active`, { signal: AbortSignal.timeout(8000) });
  const json = await res.json();
  const map = {};
  for (const t of json.data.activeTargets) map[t.labels.service] = t.health;
  return map;
}

/**
 * Entry point: runs all groups of checks and restores anything it stopped.
 *
 * @returns {Promise<void>} resolves when all checks and cleanup are done
 * @throws {Error} never. Failures are reported and set the exit code.
 */
async function main() {
  if (METRICS_TOKEN === '') {
    console.error('Set METRICS_TOKEN first (see the instructions above this script in the guide).');
    process.exit(2);
  }
  if (GRAFANA_PASSWORD === '') {
    console.error('Set GRAFANA_ADMIN_PASSWORD first.');
    process.exit(2);
  }

  let chatStopped = false;
  try {
    // ---------- Security + normal flow ----------
    for (const svc of SERVICES) {
      await check(`${svc.name}: /metrics without token -> 401`, async () => {
        const res = await fetchMetrics(svc.port, null);
        assert(res.status === 401, `expected 401, got ${res.status}`);
      });
      await check(`${svc.name}: /metrics with wrong token -> 401`, async () => {
        const res = await fetchMetrics(svc.port, 'definitely-not-the-token');
        assert(res.status === 401, `expected 401, got ${res.status}`);
      });
      await check(`${svc.name}: /metrics with token -> 200 and default metrics`, async () => {
        const res = await fetchMetrics(svc.port, METRICS_TOKEN);
        assert(res.status === 200, `expected 200, got ${res.status}`);
        const text = await res.text();
        assert(text.includes('process_resident_memory_bytes'), 'default process metrics missing');
        assert(text.includes('nodejs_eventloop_lag_seconds'), 'event loop metric missing');
      });
    }

    await check('signaling-service exposes signaling_connected_sockets', async () => {
      const text = await (await fetchMetrics(4004, METRICS_TOKEN)).text();
      assert(text.includes('signaling_connected_sockets'), 'metric missing');
    });
    await check('sfu-service exposes sfu_workers', async () => {
      const text = await (await fetchMetrics(4006, METRICS_TOKEN)).text();
      assert(text.includes('sfu_workers'), 'metric missing (did you call registerSfuStatsProvider?)');
    });
    await check('notification-service exposes bullmq_jobs', async () => {
      const text = await (await fetchMetrics(4008, METRICS_TOKEN)).text();
      assert(text.includes('bullmq_jobs'), 'metric missing (did you call registerQueueMetrics?)');
    });

    // ---------- Traffic -> metrics ----------
    await check('gateway counts real requests (401 without JWT)', async () => {
      const before = sumMetric(await gatewayMetricsText(), 'http_request_duration_seconds_count', { status_code: '401' });
      for (let i = 0; i < 3; i += 1) await gw('/api/users/me');
      const after = sumMetric(await gatewayMetricsText(), 'http_request_duration_seconds_count', { status_code: '401' });
      assert(after >= before + 3, `401 counter went from ${before} to ${after}`);
    });

    await check('gateway route label is a fixed prefix (no cardinality leak)', async () => {
      await gw('/api/v1/rooms/RANDOM-CODE-12345');
      const text = await gatewayMetricsText();
      assert(!text.includes('RANDOM-CODE-12345'), 'raw URL leaked into labels');
    });

    // ---------- Create a user for authenticated + tracing checks ----------
    const email = `obs-${Date.now()}@example.com`;
    const password = 'Password123!';
    let token = '';
    await check('signup + login through the gateway', async () => {
      const signup = await gw('/api/auth/signup', { method: 'POST', body: { email, password } });
      assert([200, 201].includes(signup.status), `signup returned ${signup.status}`);
      const login = await gw('/api/auth/login', { method: 'POST', body: { email, password } });
      assert(login.status === 200, `login returned ${login.status}`);
      token = login.json?.data?.accessToken ?? '';
      assert(token !== '', 'no accessToken in login response');
    });

    // ---------- Prometheus ----------
    await check('Prometheus: all 9 targets are up', async () => {
      await waitFor(async () => {
        const targets = await prometheusTargets();
        return SERVICES.every((s) => targets[s.name] === 'up');
      }, 60000);
    });
    await check('Prometheus: alert rules are loaded', async () => {
      const res = await fetch(`${PROMETHEUS}/api/v1/rules`, { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      assert(text.includes('ServiceDown') && text.includes('High5xxRate'), 'alert rules not found');
    });

    // ---------- Jaeger ----------
    await check('Jaeger: one trace spans api-gateway and auth-service', async () => {
      await waitFor(async () => {
        const res = await fetch(`${JAEGER}/api/traces?service=api-gateway&limit=50&lookback=1h`, { signal: AbortSignal.timeout(8000) });
        const json = await res.json();
        return (json.data ?? []).some((trace) => {
          const names = Object.values(trace.processes).map((p) => p.serviceName);
          return names.includes('api-gateway') && names.includes('auth-service');
        });
      }, 45000, 3000);
    });

    // ---------- Grafana ----------
    const auth = { Authorization: `Basic ${Buffer.from(`admin:${GRAFANA_PASSWORD}`).toString('base64')}` };
    await check('Grafana: health is ok', async () => {
      const res = await fetch(`${GRAFANA}/api/health`, { signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      assert(json.database === 'ok', `database=${json.database}`);
    });
    await check('Grafana: Prometheus and Jaeger data sources provisioned', async () => {
      const res = await fetch(`${GRAFANA}/api/datasources`, { headers: auth, signal: AbortSignal.timeout(8000) });
      assert(res.status === 200, `status ${res.status} (wrong GRAFANA_ADMIN_PASSWORD?)`);
      const uids = (await res.json()).map((d) => d.uid);
      assert(uids.includes('prometheus') && uids.includes('jaeger'), `found: ${uids.join(', ')}`);
    });
    await check('Grafana: dashboard video-meet-overview exists', async () => {
      const res = await fetch(`${GRAFANA}/api/dashboards/uid/video-meet-overview`, { headers: auth, signal: AbortSignal.timeout(8000) });
      assert(res.status === 200, `status ${res.status}`);
    });

    // ---------- Failure case: stop chat-service ----------
    if (token !== '') {
      const before = sumMetric(await gatewayMetricsText(), 'gateway_proxy_errors_total');
      compose(['stop', 'chat-service']);
      chatStopped = true;

      await check('gateway returns 502/504 (not a crash or stack trace) when chat-service is down', async () => {
        const res = await gw('/api/v1/chat/some-room/messages', { token });
        assert([502, 504].includes(res.status), `expected 502/504, got ${res.status}`);
        const raw = JSON.stringify(res.json ?? {});
        assert(!raw.includes('chat-service') && !raw.includes('ECONNREFUSED') && !raw.includes('ENOTFOUND'), 'internal name leaked to client');
      });
      await check('gateway_proxy_errors_total increased', async () => {
        const after = sumMetric(await gatewayMetricsText(), 'gateway_proxy_errors_total');
        assert(after > before, `counter ${before} -> ${after}`);
      });
      await check('Prometheus marks chat-service target as down', async () => {
        await waitFor(async () => (await prometheusTargets())['chat-service'] === 'down', 60000);
      });
      await check('Prometheus alert ServiceDown becomes pending or firing for chat-service', async () => {
        await waitFor(async () => {
          const res = await fetch(`${PROMETHEUS}/api/v1/alerts`, { signal: AbortSignal.timeout(8000) });
          const json = await res.json();
          return json.data.alerts.some((a) => a.labels.alertname === 'ServiceDown' && a.labels.service === 'chat-service');
        }, 60000);
      });
    } else {
      console.log('SKIP  failure-case tests (no token because login failed)');
    }
  } finally {
    // ---------- Cleanup: ALWAYS restart what we stopped ----------
    if (chatStopped) {
      try {
        compose(['start', 'chat-service']);
        await check('cleanup: chat-service restarted and serving /metrics again', async () => {
          await waitFor(async () => (await fetchMetrics(4005, METRICS_TOKEN)).status === 200, 90000, 3000);
        });
      } catch (error) {
        console.error(`CLEANUP FAILED - run manually: docker compose start chat-service (${error.message})`);
        results.push({ name: 'cleanup', ok: false });
      }
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

**Why this design choice:** the failure test uses a real container stop (not a mock), because the Gateway's "sanitized 502/504" and the alert path only prove themselves under a real outage. The `finally` block guarantees `chat-service` is restarted even if a check throws.

---

## Verification checklist

| #  | Check                                | Command                                                                                                                             | Expected result                                                                                         |
| -- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1  | TypeScript compiles in every service | `foreach ($s in $services) { Push-Location "services\$s"; npx tsc --noEmit; Pop-Location }`                                       | 0 errors for each                                                                                       |
| 2  | Shared copies match                  | `powershell -File scripts\sync-observability.ps1 -CheckOnly`                                                                      | `All copies match shared\observability`                                                               |
| 3  | Compose file is valid                | `docker compose config --quiet`                                                                                                   | No output, exit code 0                                                                                  |
| 4  | Stack is running                     | `docker compose ps`                                                                                                               | All services `running`; prometheus, grafana `healthy`                                               |
| 5  | `/metrics` needs a token           | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:4001/metrics`                                                              | `401`                                                                                                 |
| 6  | `/metrics` works with token        | `curl.exe -s -H "Authorization: Bearer $env:METRICS_TOKEN" http://localhost:4001/metrics \| Select-String "http_request_duration"` | Lines starting `# HELP http_request_duration_seconds`                                                 |
| 7  | Prometheus sees all targets          | Open `http://localhost:9090/targets`                                                                                              | 9 targets, all **UP**                                                                             |
| 8  | Alert rules loaded                   | Open `http://localhost:9090/alerts`                                                                                               | 7 rules listed (green = inactive)                                                                       |
| 9  | Dashboard shows data                 | Open `http://localhost:3001` → Dashboards → *Video Meet — Overview*                                                          | "Services UP" shows 9; request graphs move after you click around                                       |
| 10 | Trace crosses services               | Jaeger `http://localhost:16686` → service `api-gateway` → Find Traces after a login                                           | One trace with spans from `api-gateway` and `auth-service`                                          |
| 11 | Logs carry trace IDs                 | `docker compose logs auth-service --tail 20` after a login                                                                        | JSON lines containing `"trace_id"` and `"span_id"`                                                  |
| 12 | Gateway failure is visible           | `docker compose stop chat-service`, call a chat route with a valid JWT                                                            | `502`/`504`, counter `gateway_proxy_errors_total` grows, `ServiceDown` goes pending then firing |
| 13 | Restore                              | `docker compose start chat-service`                                                                                               | Target UP again within about 30 s                                                                       |
| 14 | E2E script                           | `node scripts\e2e-observability.mjs`                                                                                              | Last line `N/N checks passed`, exit code 0                                                            |
| 15 | Old E2E scripts still pass           | `node scripts\e2e-gateway.mjs` and `node scripts\e2e-notification.mjs`                                                          | All PASS (nothing from Phases 11–12 broke)                                                             |

---

## Troubleshooting

| Symptom                                                                     | Likely cause                                                                                  | Fix                                                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service exits at boot with `OTEL_SERVICE_NAME is required`                | Variable missing in `environment:` or local `.env`                                        | Add `OTEL_SERVICE_NAME` (Step 13.14.3) or run local dev with `tsx watch --env-file=.env server.ts`                                                                       |
| Service exits with `METRICS_TOKEN must be set and at least 16 characters` | `NODE_ENV=production` but token missing or short                                            | Check `infra\observability.env` is listed in `env_file` and the token is 16+ characters                                                                                  |
| Prometheus target shows `401 Unauthorized`                                | Token in `metrics_token` differs from `METRICS_TOKEN`, or the file has a trailing newline | Recreate the file with `Set-Content -NoNewline` using the exact same value, then `docker compose restart prometheus`                                                     |
| Prometheus target `connection refused` / `no such host`                 | Wrong service name or port in `prometheus.yml`, or the service crashed                      | `docker compose ps`, `docker compose logs <service>`, compare names with `docker-compose.yml`                                                                          |
| Prometheus fails to start, `permission denied` on `metrics_token`       | File permissions on the mounted file                                                          | On Docker Desktop (Windows) this is rare. Make sure it is a **file** and not a folder (`Test-Path -PathType Leaf infra\prometheus\metrics_token`)                    |
| Labels show `exported_service`                                            | Your code set a `service` label                                                             | Remove any custom `service` label. Only Prometheus adds it                                                                                                                 |
| Dashboard panels say "No data"                                              | Prometheus target is down, or wrong data source                                               | Check `/targets` first, then Grafana → Connections → Data sources → Prometheus → *Save & test*                                                                       |
| Grafana shows an empty dashboard list                                       | Wrong mount path or invalid JSON                                                              | `docker compose logs grafana \| Select-String "provisioning"`; validate JSON with `Get-Content infra\grafana\dashboards\video-meet-overview.json -Raw \| ConvertFrom-Json` |
| `docker compose` error `set GRAFANA_ADMIN_PASSWORD in .env`             | Root `.env` missing                                                                         | Create `.env` next to `docker-compose.yml` (Step 13.14.1)                                                                                                                |
| Jaeger has no services or traces                                            | Tracing import is not the first line, `OTEL_ENABLED=false`, or the endpoint is wrong        | Make `import './src/observability/tracing.js'` the first line of `server.ts`; check `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` (no `/v1/traces`)               |
| Traces exist but are not linked across services                             | An upstream is not instrumented, or an old OTel version is mixed in                           | Run `npm ls @opentelemetry/api` in that service. There must be one version only                                                                                            |
| `ERESOLVE` or type errors from `@opentelemetry/*`                       | Mixed v1 and v2 packages                                                                      | Remove old `@opentelemetry/*` packages and reinstall Step 13.1 together                                                                                                    |
| `/metrics` is slow or Prometheus memory grows                             | High-cardinality label                                                                        | Search for `room`, `user`, or `code` in label values: `curl ... \| Select-String "route="`. Use route patterns or the fixed list                                      |
| `http_requests_in_flight` never returns to 0                              | `/metrics` mounted before the middleware, or the middleware is in the wrong place           | Mount `httpMetricsMiddleware()` once, before routes. `close` handling is already in the code                                                                             |
| `sfu_*` gauges missing                                                    | `registerSfuStatsProvider` is never called                                                  | Add it in `server.ts` after the workers start (Step 13.10.2)                                                                                                               |
| `bullmq_jobs` missing                                                     | Queues were not registered                                                                    | Add `registerQueueMetrics([...])` (Step 13.11.2)                                                                                                                           |
| E2E: `429` during signup                                                  | Auth limiter (10 per 15 minutes) reached by repeated runs                                     | Wait 15 minutes, or `docker compose restart redis` in development only                                                                                                     |
| E2E: `chat-service` is not back after the run                             | Script was killed (Ctrl+C) before `finally`                                                 | `docker compose start chat-service`                                                                                                                                        |

---

## Update the docs after it passes

| File                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEP.MD`                                               | In the dashboard table, change Phase 13 from `⏳ PENDING` to `✅ COMPLETED` with details: "`/metrics` on all 9 services (prom-client), Prometheus + alert rules, Grafana provisioned dashboard, OpenTelemetry → Jaeger, Pino `trace_id`. Verified via `e2e-observability.mjs`." Replace the Phase 13 section with a Step 13.1–13.15 list marked ✅. In the header line change "Phases 0 through 12" to "Phases 0 through 13". In the final Mermaid diagram, give `P13` the green style (`fill:#e8ffe8,stroke:#3fae3f`). |
| Status report (`Services & Architecture Status Report`) | Change the Phase 13 row from `⏳ Partial` to `✅ Completed`. Add Prometheus, Grafana, and Jaeger to the architecture Mermaid diagram. Add a short "Observability" section (ports 9090 / 3001 / 16686, `/metrics` token). Update the "Remaining Roadmap" list.                                                                                                                                                                                                                                                                     |
| Root `README.md`                                        | Add `prometheus`, `grafana`, `jaeger` to the Service Overview table. Add an "Observability" section: how to open the three UIs, how `METRICS_TOKEN` works, the folder entries `infra\prometheus`, `infra\grafana`, `shared\observability`. Add `GET /metrics` to each service as a note: "not routed through the Gateway for clients". Update the Local Development note about `--env-file=.env`. Add the `/metrics` auth row to the *JWT Authentication Pattern* table (Bearer metrics token, not JWT).          |
| Each service `README.md`                                | Add the env variables from Step 13.2 and one line about `/metrics`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `services\api-gateway\README.md`                        | Document `gateway_proxy_errors_total` and `gateway_rate_limit_hits_total`, and that `/metrics` sits before the global rate limiter.                                                                                                                                                                                                                                                                                                                                                                                               |
| `.env.example` files                                    | Add `OTEL_SERVICE_NAME`, `METRICS_ENABLED`, `METRICS_TOKEN`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` (no real secrets).                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## Next

Phase 14 (CI/CD) can now rely on three things: every service builds with the same observability files (so `sync-observability.ps1 -CheckOnly` can run as a CI step), every service answers a **protected** `GET /metrics` (so a smoke test after deploy can check health with numbers, not only `/health`), and the alert rules in `infra\prometheus\alerts.yml` are ready to be reused as Kubernetes `PrometheusRule` objects in Phase 15. Phase 16 (load testing) can use the Grafana dashboard to watch p95 latency, event-loop lag, SFU producers/consumers, and queue backlogs while Artillery pushes traffic.
