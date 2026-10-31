# notification-service

**Port:** 4008 | **Database:** PostgreSQL (`notification_db`)  
**Status:** ✅ Completed (with Phase 13 Observability)

Handles asynchronous email dispatch for meeting invitations and scheduled meeting reminders using BullMQ and Nodemailer, with automatic cancellation when rooms end, and integration with Mailpit for development testing.

---

## What it does

- Queues transactional meeting invitations for immediate delivery.
- Schedules delayed reminder jobs (15 minutes prior to scheduled meeting time).
- Subscribes to room lifecycle events to automatically cancel reminders when rooms are deleted or ended.
- Connects to local SMTP mail service (`mailpit:1025`) with web UI on port `8025`.

---

## Observability & Metrics

Exposes `GET /metrics` protected by Bearer `METRICS_TOKEN`:
- Exposes standard Node.js runtime and HTTP metrics.
- Exposes BullMQ queue metrics via `registerQueueMetrics([emailQueue])`:
  - `bullmq_jobs_waiting{queue="email-queue"}`
  - `bullmq_jobs_active{queue="email-queue"}`
  - `bullmq_jobs_delayed{queue="email-queue"}`
  - `bullmq_jobs_failed{queue="email-queue"}`
  - `bullmq_jobs_completed{queue="email-queue"}`
- Exposes custom email counters:
  - `notifications_emails_sent_total{template="invite|reminder", status="success|failed"}`

---

## Routes

Internal mount: `app.use('/v1/notifications', notificationRoutes)`

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| POST | `/v1/notifications/invites` | ✅ JWT | Dispatches meeting invitation emails to guest list |
| GET  | `/health` | ❌ | Health check |
| GET  | `/metrics` | Bearer `METRICS_TOKEN` | Prometheus exposition format (scraped by Prometheus container) |

---

## Environment Variables

| Variable | Example | Required | Purpose |
|---|---|---|---|
| `PORT` | `4008` | ✅ | Service listening port |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/notification_db` | ✅ | Database connection string |
| `JWT_ACCESS_SECRET` | `secret` | ✅ | JWT verification secret |
| `REDIS_URL` | `redis://redis:6379` | ✅ | Redis connection for BullMQ queues and Pub/Sub |
| `SMTP_HOST` | `mailpit` | ✅ | SMTP server host |
| `SMTP_PORT` | `1025` | ✅ | SMTP server port |
| `SMTP_FROM` | `no-reply@videomeet.local` | ✅ | Default sender address |
| `NODE_ENV` | `production` | ✅ | Environment mode |
| `OTEL_SERVICE_NAME` | `notification-service` | ✅ | Service identifier for OpenTelemetry traces |
| `METRICS_ENABLED` | `true` | ❌ (default `true`) | Enables `/metrics` endpoint |
| `METRICS_TOKEN` | `secret` | ✅ | Bearer token required for `/metrics` |
| `OTEL_ENABLED` | `true` | ❌ (default `true`) | Enables OpenTelemetry tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://jaeger:4318` | ❌ | Jaeger OTLP/HTTP endpoint |

