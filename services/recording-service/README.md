# recording-service

**Port:** 4007 | **Database:** PostgreSQL (`recording_db`)  
**Status:** ✅ Completed (with Phase 13 Observability)

Handles media recording lifecycle, per-peer raw RTP capture via mediasoup `PlainTransport`, background transcoding with BullMQ and FFmpeg into web-optimized `.mp4` files, and secure download delivery.

---

## What it does

- Captures live audio and video RTP streams directly from `sfu-service`.
- Dispatches background transcode jobs to BullMQ queues (`finalizeQueue` and `autoStopQueue`).
- Transcodes raw media into `.mp4` using `fluent-ffmpeg`.
- Exposes REST endpoints for recording start, stop, metadata lookup, and streaming downloads.
- Implements automated recovery and auto-stop when rooms end.

---

## Observability & Metrics

Exposes `GET /metrics` protected by Bearer `METRICS_TOKEN`:
- Exposes standard Node.js runtime and HTTP metrics.
- Exposes BullMQ queue metrics via `registerQueueMetrics([finalizeQueue, autoStopQueue])`:
  - `bullmq_jobs_waiting{queue="..."}`
  - `bullmq_jobs_active{queue="..."}`
  - `bullmq_jobs_delayed{queue="..."}`
  - `bullmq_jobs_failed{queue="..."}`
  - `bullmq_jobs_completed{queue="..."}`

---

## Routes

Internal mount: `app.use('/v1/recordings', recordingRoutes)`

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| POST | `/v1/recordings/start` | ✅ JWT | Initiates recording for a meeting room |
| POST | `/v1/recordings/stop` | ✅ JWT | Stops active recording and enqueues transcode job |
| GET  | `/v1/recordings/room/:roomId` | ✅ JWT | Fetches all recordings for a room |
| GET  | `/v1/recordings/:recordingId` | ✅ JWT | Fetches status and metadata of a recording |
| GET  | `/v1/recordings/:recordingId/download` | ✅ JWT | Streams the completed `.mp4` recording file |
| GET  | `/health` | ❌ | Health check |
| GET  | `/metrics` | Bearer `METRICS_TOKEN` | Prometheus exposition format (scraped by Prometheus container) |

---

## Environment Variables

| Variable | Example | Required | Purpose |
|---|---|---|---|
| `PORT` | `4007` | ✅ | Service listening port |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/recording_db` | ✅ | Database connection string |
| `JWT_ACCESS_SECRET` | `secret` | ✅ | JWT verification secret |
| `REDIS_URL` | `redis://redis:6379` | ✅ | Redis connection for BullMQ queues |
| `SFU_SERVICE_URL` | `http://sfu-service:4006` | ✅ | SFU service communication |
| `NODE_ENV` | `production` | ✅ | Environment mode |
| `OTEL_SERVICE_NAME` | `recording-service` | ✅ | Service identifier for OpenTelemetry traces |
| `METRICS_ENABLED` | `true` | ❌ (default `true`) | Enables `/metrics` endpoint |
| `METRICS_TOKEN` | `secret` | ✅ | Bearer token required for `/metrics` |
| `OTEL_ENABLED` | `true` | ❌ (default `true`) | Enables OpenTelemetry tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://jaeger:4318` | ❌ | Jaeger OTLP/HTTP endpoint |
