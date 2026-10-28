
# Phase 13 — Observability: Detailed Explanation (Simple English)

> Goal of this file: explain **why** Phase 13 is needed, **what problems** it solves, **what happens if we skip it**, **what benefits** we get, and **why we built it this specific way**.
> For the code and steps, see the main guide `Phase 13 — Observability`. This file is only the "understanding" part.

---

## Table of Contents

1. [What is Phase 13 in one line?](#1-what-is-phase-13-in-one-line)
2. [What does &#34;Observability&#34; mean?](#2-what-does-observability-mean)
3. [The big problem today: 9 black boxes](#3-the-big-problem-today-9-black-boxes)
4. [The 3 pillars: Metrics, Traces, Logs](#4-the-3-pillars-metrics-traces-logs)
5. [Problems we are solving (10 problems)](#5-problems-we-are-solving-10-problems)
6. [What happens if we do NOT do this phase?](#6-what-happens-if-we-do-not-do-this-phase)
7. [Benefits we get after this phase](#7-benefits-we-get-after-this-phase)
8. [How it works (simple flow)](#8-how-it-works-simple-flow)
9. [Every tool: what it does and why we chose it](#9-every-tool-what-it-does-and-why-we-chose-it)
10. [Why we built it this way (design decisions)](#10-why-we-built-it-this-way-design-decisions)
11. [What we measure in each service](#11-what-we-measure-in-each-service)
12. [Alert rules: what they watch](#12-alert-rules-what-they-watch)
13. [Security of observability](#13-security-of-observability)
14. [What is NOT in this phase (and why)](#14-what-is-not-in-this-phase-and-why)
15. [Costs and trade-offs (honest view)](#15-costs-and-trade-offs-honest-view)
16. [A real-life story: before vs after](#16-a-real-life-story-before-vs-after)
17. [How this helps Phase 14, 15, 16](#17-how-this-helps-phase-14-15-16)
18. [Simple words dictionary](#18-simple-words-dictionary)
19. [One-minute explanation (for interviews or demos)](#19-one-minute-explanation-for-interviews-or-demos)
20. [Final summary](#20-final-summary)

---

## 1. What is Phase 13 in one line?

- Phase 13 makes our **9 services visible**: we can **measure** them, **follow** a request across them, and get **warned** when something breaks.
- **No business logic changes.** Login, rooms, chat, video — all work the same. We only add "eyes" to the system.

---

## 2. What does "Observability" mean?

- Observability = **"Can I understand what is happening inside my system by looking at its outputs?"**
- Simple example — **a car**:
  - Without a dashboard: you drive, and you only know there is a problem when the engine stops.
  - With a dashboard: you see speed, fuel, engine temperature, warning lights — **before** the car breaks.
- Phase 13 builds the **dashboard + warning lights** for our Video Meet app.

---

## 3. The big problem today: 9 black boxes

Right now we have these services:

- `api-gateway`, `auth-service`, `user-service`, `room-service`
- `signaling-service`, `chat-service`, `sfu-service`
- `recording-service`, `notification-service`

**What we have today:**

- Only **Pino logs** (text lines saying what happened).
- Each service writes its **own separate** log stream.
- **No numbers over time** (how many requests? how slow? how many errors?).
- **No link** between logs of different services for the same user request.
- **No alert** when something dies.

**Why this is a problem:**

- One login request touches: Gateway → Auth → Redis → Postgres.
- If it is slow, we do not know **which part** is slow.
- With 9 services, finding a problem by reading logs is like **searching for a needle in 9 haystacks**.

---

## 4. The 3 pillars: Metrics, Traces, Logs

Observability stands on 3 things. Phase 13 completes all three.

| Pillar            | Simple meaning                      | Question it answers                                   | Tool we use                        |
| ----------------- | ----------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| **Metrics** | Numbers over time                   | "Is something wrong **right now**? Since when?" | Prometheus + Grafana               |
| **Traces**  | Path of ONE request across services | "**Where** exactly is it slow or failing?"      | OpenTelemetry + Jaeger             |
| **Logs**    | Text lines of events                | "**Why** did it fail? What was the error?"      | Pino (already have) + `trace_id` |

**How they work together (the investigation flow):**

1. **Metrics** tell you: "Error rate went up at 10:05."
2. **Traces** tell you: "Requests are slow inside `auth-service` → database call."
3. **Logs** tell you: "Error: connection pool exhausted."

- Before Phase 13 we only had step 3, and even that was hard to find.

---

## 5. Problems we are solving (10 problems)

| #  | Problem today                                         | Real example                                                                            | How Phase 13 fixes it                                                                                      |
| -- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1  | Only logs, no numbers over time                       | Users say "calls feel slow". You cannot tell if it started 5 minutes or 5 days ago      | Every service exposes **Prometheus metrics** (request rate, errors, latency, memory, event-loop lag) |
| 2  | A request crosses many services but logs are separate | Login takes 4 seconds. Is it Gateway, Auth, bcrypt, or Postgres?                        | **OpenTelemetry tracing**: one trace ID follows the request everywhere                               |
| 3  | Logs and traces are not linked                        | You find a slow trace but cannot find its log lines                                     | Pino adds `trace_id` and `span_id` to **every log line**                                         |
| 4  | Nobody is told when a service dies                    | `chat-service` crashes at night, messages are lost                                    | **Prometheus alert rules** (`ServiceDown`, `High5xxRate`, ...)                                   |
| 5  | Real-time parts are invisible                         | Signaling sockets leak, or one SFU worker has 200 consumers                             | **Custom gauges**: connected sockets, SFU workers / routers / transports / producers / consumers     |
| 6  | Background queues fail silently                       | Emails pile up in BullMQ because SMTP is down, but API still says `201`               | `bullmq_jobs{queue,state}` gauge + email result counter                                                  |
| 7  | Gateway protection is invisible                       | Attacker causes thousands of 429s, or a service is down and Gateway returns 502 all day | `gateway_rate_limit_hits_total` and `gateway_proxy_errors_total`                                       |
| 8  | `/metrics` can leak internals if left open          | Anyone on the internet reads route names, memory use, queue sizes                       | Bearer `METRICS_TOKEN`, constant-time compare, tools bound to `127.0.0.1`                              |
| 9  | Metrics can explode memory (high cardinality)         | A label with room code or user ID creates a new series per request and kills Prometheus | Labels use **route pattern** (`/v1/rooms/:code`), never the real URL                               |
| 10 | Nothing proves the setup works                        | You only discover broken scraping during a real incident                                | **E2E script** tests scraping, auth, traces, dashboard, and a real failure                           |

---

## 6. What happens if we do NOT do this phase?

**Key points — the risks of skipping:**

- **You are blind in production.**
  - You only learn about problems when **users complain**. By then it is already bad.
- **Slow debugging.**
  - Finding one bug can take hours, because you grep 9 separate log streams.
- **Silent failures.**
  - A queue stuck, a socket leak, a crashed service — nothing tells you.
- **No proof of performance.**
  - Phase 16 (load testing) needs graphs (p95 latency, event-loop lag, queue backlog). Without Phase 13 you run the test and see **nothing useful**.
- **Phase 15 (Kubernetes) becomes risky.**
  - K8s restarts pods automatically. Without metrics you will not even know pods are restarting all day.
- **Security risk stays hidden.**
  - You cannot see abuse patterns (rate-limit spikes, 502 floods).
- **Not "production ready".**
  - A real production system always has monitoring. Without it the project stays a demo.

**Example of what goes wrong:**

| Situation                        | Without Phase 13                            | With Phase 13                                      |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| `chat-service` crashes at 2 AM | Found next morning when users complain      | `ServiceDown` alert after 1 minute               |
| Login is slow                    | Guessing, adding `console.log` everywhere | Open Jaeger, see the slow span in 30 seconds       |
| SFU overloaded                   | Video freezes, no idea why                  | Dashboard shows consumers piling up on one worker  |
| SMTP down                        | Invites silently never sent                 | `bullmq_jobs{state="failed"}` rises, alert fires |

---

## 7. Benefits we get after this phase

- **See everything in one place**
  - One Grafana dashboard: `Video Meet — Overview`.
- **Find the slow part fast**
  - Click one request in Jaeger, see time spent in each service.
- **Know before users complain**
  - Alerts fire on down services, high 5xx, high latency, queue backlog, blocked event loop.
- **Connect logs and traces**
  - Search logs by `trace_id`.
- **Watch real-time health**
  - Sockets, SFU objects, queue sizes.
- **Prove protections work**
  - Rate limits and 502/504 trap from Phase 12 become visible.
- **Safe by default**
  - Token-protected `/metrics`, tools only on localhost.
- **Repeatable setup**
  - Grafana is auto-provisioned from files: same result on any machine.
- **Ready for the future**
  - CI/CD checks, Kubernetes alert rules, load-test dashboards all reuse this work.

---

## 8. How it works (simple flow)

**Metrics flow (pull model):**

1. Each service has `GET /metrics` on its **existing port** (4000–4008).
2. **Prometheus** visits every service every **15 seconds** and reads `/metrics` (with a Bearer token).
3. Prometheus stores the numbers and checks **alert rules**.
4. **Grafana** asks Prometheus for numbers and draws graphs.

**Trace flow (push model):**

1. A request enters the Gateway. OpenTelemetry starts a **trace ID**.
2. Gateway calls Auth and adds a `traceparent` header.
3. Auth sees the header and **continues the same trace** (child span).
4. Each service sends its spans to **Jaeger** (OTLP/HTTP, port 4318, Docker network only).
5. Jaeger shows the whole request as **one tree**.

**Log flow:**

1. Pino writes a log line.
2. `traceMixin` adds `trace_id` and `span_id` automatically.
3. Copy the trace ID from Jaeger → search logs → find exact lines.

**Ports:**

| Tool        | Port                                    | Access              |
| ----------- | --------------------------------------- | ------------------- |
| Prometheus  | `9090`                                | localhost only      |
| Grafana     | `3001` (host) → `3000` (container) | localhost only      |
| Jaeger UI   | `16686`                               | localhost only      |
| Jaeger OTLP | `4318`                                | Docker network only |

- Grafana uses `3001` because `3000` is already used by `test-client`.

---

## 9. Every tool: what it does and why we chose it

| Tool                               | What it does                                                     | Why this one                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **`prom-client`**          | Node.js library that creates metrics and the `/metrics` text   | Standard library for Prometheus in Node. Gives default metrics (CPU, memory, event-loop lag, GC) for free |
| **Prometheus**               | Collects (scrapes) metrics, stores time-series, evaluates alerts | Industry standard. Pull model = services stay simple. Works with Kubernetes in Phase 15                   |
| **Grafana**                  | Draws dashboards from Prometheus data                            | Most popular dashboard tool. Can be fully set up from files (provisioning)                                |
| **OpenTelemetry (OTel) SDK** | Auto-creates spans for http, express, pg, ioredis, mongodb       | Vendor-neutral standard. Auto-instrumentation = very little code                                          |
| **Jaeger**                   | Stores and shows traces                                          | Simple all-in-one container, free, good UI                                                                |
| **Pino (already installed)** | Structured JSON logs                                             | Already in project. We only add 2 fields (`trace_id`, `span_id`)                                      |

---

## 10. Why we built it this way (design decisions)

Each decision below has a **reason**. This is the "why only this way" part.

### 10.1 Code first, infrastructure second

- Shared module compiles by itself, so we can test **one service** before Docker.
- Prove it in `auth-service` first, then copy to the rest. **A mistake is fixed once, not nine times.**

### 10.2 Prometheus before Grafana

- Grafana only shows what Prometheus stores.
- If Prometheus targets are not "UP", dashboards stay empty. So we check Prometheus first.

### 10.3 Shared folder + copy script (not an npm package)

- Each Docker image is built from **only its own folder**, so it cannot import from `shared/`.
- Solution: one master copy in `shared/observability/`, a script copies it into each service.
- `sync-observability.ps1 -CheckOnly` detects **drift** (someone edited one copy by hand). Can run in CI (Phase 14).
- Why not a monorepo or npm package? That would need changes to 9 Dockerfiles and extra tooling. Copying is **boring but safe**.

### 10.4 Fail-fast config (`config.ts`)

- If `METRICS_TOKEN` is missing in production, `/metrics` would be **open to everyone** and nobody would notice.
- So the service **refuses to start** with a clear error message.
- Strict `"true"` / `"false"` only: typos like `"yes"` or `"True"` crash at boot instead of silently leaving things open.
- `Object.freeze` stops other code from changing the token at runtime.
- `config.ts` has **no dependencies** (no Joi, no dotenv) because it must run **before** everything else.

### 10.5 Route **pattern** labels, not real URLs (very important)

| Approach                    | Example label        | Problem                                                      |
| --------------------------- | -------------------- | ------------------------------------------------------------ |
| Real URL (bad)              | `/v1/rooms/AbC123` | Unlimited values → memory leak (**high cardinality**) |
| Route pattern (good)        | `/v1/rooms/:code`  | Small fixed set                                              |
| Fixed prefix list (Gateway) | `/api/v1/rooms`    | Small fixed set                                              |

- Every new room code would create a **new time series**. Prometheus would run out of memory.
- 404 scans use the label `unmatched`, so attackers cannot create labels either.
- Gateway is a proxy (Express has no route pattern), so it uses a **fixed list of known prefixes**.

### 10.6 One histogram instead of many metrics

- `http_request_duration_seconds` gives: request count (`_count`), total time (`_sum`), and latency buckets (for p95).
- No need for a separate counter.

### 10.7 `res.on('close')` as well as `finish`

- If a client disconnects early, `finish` never fires.
- Without `close`, the "in flight" gauge gets **stuck above zero forever** and the dashboard slowly lies.
- A `finished` flag makes sure we record each request only once.

### 10.8 Tracing must be the **first import** in `server.ts`

- OTel must patch `http`, `express`, `pg`, `ioredis`, `mongodb` **before** they load.
- In ESM, imports run in the order written, so **first line = first to run**.
- If it is not first, traces will be missing or not linked.

### 10.9 Ignore `/metrics`, `/health`, `/ready` in traces

- Prometheus and Docker call them constantly.
- Without ignoring, Jaeger fills with useless spans.
- Also `fs` instrumentation is **off** (thousands of useless spans).

### 10.10 Sampling via environment variables

- `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=1.0`.
- Dev = keep **all** traces (1.0). Production can use `0.1` (10%) to save cost.
- "Parent based" = child services follow the parent's decision, so a trace is never half-cut.

### 10.11 Tracing failure must never kill the app

- If OTel fails to start, we log the error and **keep the service running**.
- Observability must never take the product down.
- On shutdown we flush spans but do **not** call `process.exit` (the service has its own graceful shutdown).

### 10.12 Gauges that read values only when Prometheus scrapes (`collect`)

- Used for SFU objects and BullMQ queue counts.
- **No timer, no extra cost** between scrapes.
- If the stats function breaks, it is wrapped in `try/catch` so the whole `/metrics` does not fail.
- SFU: we cannot see how you store Maps, so you give **one small `getStats` function**.

### 10.13 Whitelist of socket event names

- Event names come from clients.
- If used directly as labels, an attacker could send random names → endless series.
- We only label **known** events (`join-room`, `offer`, `answer`, ...). Everything else = `other`.

### 10.14 Prometheus owns the `service` label

- Prometheus adds `service` from `prometheus.yml`.
- If our code also sets `service`, Prometheus renames ours to `exported_service` and queries get confusing.
- So our code **never** sets a `service` label.

### 10.15 Token from a **file** (`credentials_file`)

- Token is not written in `prometheus.yml`.
- File is mounted **read-only**; must be created with `-NoNewline`, otherwise the trailing newline causes `401`.

### 10.16 `/metrics` mounted **before** auth guards and the global rate limiter

- Prometheus has no user JWT. The **metrics token** is its credential.
- On the Gateway it sits before the rate limiter so scrapes are never blocked by 429.

### 10.17 Grafana provisioning (files, not clicking)

- Data sources and dashboard come from files.
- A fresh `docker compose up` on any machine gives the **same result**. Fixed UIDs (`prometheus`, `jaeger`) let the dashboard JSON refer to them.
- `disableDeletion: true`, `allowUiUpdates: false` → dashboard cannot be changed by accident.

### 10.18 Real failure test in E2E

- The E2E script **stops `chat-service` for real** and checks: Gateway returns 502/504, counter rises, target goes down, `ServiceDown` alert appears.
- A mock cannot prove the sanitized 502/504 path and alert path. Only a real outage can.
- A `finally` block **always restarts** `chat-service`, even if a test throws.

---

## 11. What we measure in each service

**All 9 services (generic):**

- `http_request_duration_seconds` — count, sum, latency buckets (by method, route, status)
- `http_requests_in_flight` — requests being handled now
- Default Node metrics — CPU, memory (RSS), event-loop lag, GC

**Special metrics:**

| Service                  | Metric                                                                                     | What it tells you                                             |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `api-gateway`          | `gateway_proxy_errors_total{target,status}`                                              | Which upstream is failing (502/504)                           |
| `api-gateway`          | `gateway_rate_limit_hits_total{limiter}`                                                 | Which limiter is rejecting (global/auth/refresh/api/download) |
| `signaling-service`    | `signaling_connected_sockets`                                                            | Open WebSocket count (leak detector)                          |
| `signaling-service`    | `signaling_events_total{event}`                                                          | Event traffic by (safe) event name                            |
| `sfu-service`          | `sfu_workers`, `sfu_routers`, `sfu_transports`, `sfu_producers`, `sfu_consumers` | Load on the most expensive service                            |
| `recording-service`    | `bullmq_jobs{queue,state}`                                                               | Finalize / auto-stop queue health                             |
| `notification-service` | `bullmq_jobs{queue,state}`                                                               | Email queue health                                            |
| `notification-service` | `notification_email_jobs_total{type,result}`                                             | Invite/reminder emails sent vs failed                         |

---

## 12. Alert rules: what they watch

| Alert                     | Fires when                        | Severity | Meaning in simple words              |
| ------------------------- | --------------------------------- | -------- | ------------------------------------ |
| `ServiceDown`           | `up == 0` for 1 min             | critical | Prometheus cannot reach a service    |
| `High5xxRate`           | 5xx errors > 5% for 5 min         | warning  | Service is failing too often         |
| `HighLatencyP95`        | p95 latency > 1 s for 10 min      | warning  | 5% of users wait more than 1 second  |
| `GatewayUpstreamErrors` | more than 5 proxy errors in 5 min | critical | Gateway cannot reach a backend       |
| `QueueBacklog`          | waiting jobs > 100 for 10 min     | warning  | Jobs are piling up                   |
| `QueueFailedJobs`       | failed jobs > 10 for 5 min        | warning  | Jobs keep failing                    |
| `EventLoopLagHigh`      | event-loop p99 > 200 ms for 5 min | warning  | Node process is blocked / overloaded |

- The `for:` time avoids **false alarms** from short spikes.
- Alerts are **visible** in Prometheus and Grafana. Sending to email/Slack (Alertmanager) is a later step.

---

## 13. Security of observability

Observability data is **sensitive** (route names, memory, queue sizes). So:

- **`METRICS_TOKEN`** (Bearer) required; **mandatory and 16+ chars** when `NODE_ENV=production`.
- Token compared with **`timingSafeEqual`** (constant time) to stop timing attacks.
- `/metrics` errors never show internals (generic message only).
- Prometheus, Grafana, Jaeger bound to **`127.0.0.1`** (only your machine).
- Jaeger OTLP port **not published** (only Docker network).
- Grafana **no default `admin/admin`**: Compose refuses to start without `GRAFANA_ADMIN_PASSWORD`. Sign-up and anonymous access off.
- Config files mounted **`:ro`** (read-only).
- Secrets files (`.env`, `infra/observability.env`, `infra/prometheus/metrics_token`) are in **`.gitignore`**.
- Prometheus keeps data only **15 days** (`retention.time=15d`) so the disk does not fill.

---

## 14. What is NOT in this phase (and why)

| Not included                             | Why                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Log shipping (Loki / ELK)                | Bigger topic. Logs stay in Docker for now; `trace_id` already links them  |
| Alertmanager (email/Slack notifications) | Alerts are visible now; notifications come later                            |
| Long-term metric storage                 | 15 days is enough for this stage                                            |
| Kubernetes ServiceMonitors               | Belongs to Phase 15. Alert rules are written now so Phase 15 can reuse them |

- Keeping the scope small = less risk, easier to verify.

---

## 15. Costs and trade-offs (honest view)

- **More containers**: 3 new (Prometheus, Grafana, Jaeger) → a bit more RAM/CPU.
- **Small overhead in each service**: metrics middleware + tracing. Very small, and tracing can be switched off (`OTEL_ENABLED=false` = zero cost).
- **Copy-based sharing**: need to run the sync script after editing shared files (drift check helps).
- **More environment variables to manage**: but fail-fast config catches mistakes early.
- **Trace volume**: in production, lower sampling (for example `0.1`).
- **Learning curve**: new tools, but the benefits are much bigger than the cost.

---

## 16. A real-life story: before vs after

**Scenario:** During a team meeting with 10 people, video starts freezing, and chat messages arrive late.

**Before Phase 13:**

1. User reports "calls feel slow".
2. You open logs of 9 services one by one.
3. You do not know when it started or which service is the cause.
4. You guess: maybe SFU? maybe Redis? You add `console.log` and redeploy.
5. Hours pass.

**After Phase 13:**

1. Alert `EventLoopLagHigh` fires for `signaling-service`.
2. Open Grafana: sockets jumped and SFU consumers are high on one worker; event-loop lag graph is red.
3. Open Jaeger: slow requests show a long Redis span.
4. Copy `trace_id`, search logs, find the exact error line.
5. Fix found in **minutes**, with proof from graphs.

---

## 17. How this helps Phase 14, 15, 16

| Next phase                         | How Phase 13 helps                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 14 — CI/CD**        | `sync-observability.ps1 -CheckOnly` can run in CI. After deploy, a smoke test can check `/metrics` with numbers, not only `/health` |
| **Phase 15 — Kubernetes**   | `alerts.yml` can be reused as `PrometheusRule`. Metrics show pod restarts and load for autoscaling (HPA)                              |
| **Phase 16 — Load testing** | Artillery pushes traffic while you watch p95 latency, event-loop lag, SFU producers/consumers, queue backlog on Grafana                   |

---

## 18. Simple words dictionary

| Word                     | Simple meaning                                                         |
| ------------------------ | ---------------------------------------------------------------------- |
| **Observability**  | Ability to understand the system by looking at its outputs             |
| **Metric**         | A number measured over time (for example requests per second)          |
| **Time series**    | One metric value stored again and again with timestamps                |
| **Scrape**         | Prometheus visiting `/metrics` to read numbers                       |
| **Label**          | Extra tag on a metric (for example `route="/v1/rooms/:code"`)        |
| **Cardinality**    | Number of different label combinations. Too many = memory problem      |
| **Histogram**      | Metric that counts how many requests fell into time buckets (for p95)  |
| **p95 latency**    | 95% of requests are faster than this value                             |
| **Gauge**          | A number that can go up and down (for example connected sockets)       |
| **Counter**        | A number that only goes up (for example total errors)                  |
| **Trace**          | The full journey of one request across services                        |
| **Span**           | One step inside a trace (for example "auth-service handles login")     |
| **OTLP**           | Standard format/protocol to send traces                                |
| **Sampling**       | Keeping only some traces (for example 10%) to save cost                |
| **Provisioning**   | Setting up Grafana from files automatically                            |
| **Event-loop lag** | How long Node.js is blocked. High = service feels slow                 |
| **5xx**            | Server error status codes (500–599)                                   |
| **502 / 504**      | Gateway could not reach the service / service took too long            |
| **Alert rule**     | A condition that fires when something looks bad                        |
| **Fail-fast**      | Crash at startup if config is wrong, instead of failing silently later |
| **Drift**          | A copied file that no longer matches the master copy                   |

---

## 19. One-minute explanation (for interviews or demos)

> "Our app has 9 microservices, so debugging with only logs was slow. In Phase 13 I added observability.
> Every service exposes a protected `/metrics` endpoint using `prom-client`. Prometheus scrapes them every 15 seconds and runs alert rules like ServiceDown and High5xxRate. Grafana shows one overview dashboard, auto-provisioned from files.
> I also added OpenTelemetry tracing that sends traces to Jaeger, so one request can be followed from the Gateway to Auth and beyond. Pino logs now include `trace_id`, so logs and traces connect.
> I added custom metrics for the Gateway (rate limits, 502/504), Signaling (sockets), SFU (workers, transports, producers, consumers) and BullMQ queues.
> I was careful about security and cost: token-protected metrics, localhost-only tools, and route-pattern labels to avoid high-cardinality memory problems.
> Finally, an E2E script stops a real service and checks that the metrics, the alert, and the 502 handling all work."

---

## 20. Final summary

**Key points to remember:**

- Phase 13 = **eyes and alarms** for the system. No feature changes.
- Three pillars: **Metrics** (what/when), **Traces** (where), **Logs** (why).
- Tools: `prom-client` + Prometheus + Grafana (metrics), OpenTelemetry + Jaeger (traces), Pino + `trace_id` (logs).
- Without it: blind production, slow debugging, silent failures, useless load tests, risky Kubernetes move.
- With it: one dashboard, one trace per request, alerts before users complain.
- Built **safely**: fail-fast config, token-protected `/metrics`, low-cardinality labels, localhost-only tools, tracing that can never crash the app.
- Built **in order**: one service first → all services → custom metrics → Prometheus → Grafana → E2E with a real failure test.
- It prepares the project for **CI/CD, Kubernetes, and load testing**.
