# Phase 13 Observability Verification & Testing Guide

This document is the definitive operational playbook for verifying and troubleshooting the **Phase 13 Observability Infrastructure** across the Google Meet clone platform. Use this guide whenever deploying changes, spinning up environments, or performing telemetry audits.

---

## 1. Quick Start: 1-Command Automated E2E Verification

The repository includes a comprehensive automated verification script (`scripts/e2e-observability.mjs`) executing **44 strict assertions** across security, metrics exposition, distributed tracing, alerting, Grafana provisioning, and failure recovery.

### Running the Test Suite:

```powershell
# 1. Load the Bearer metrics token and Grafana credentials
$env:METRICS_TOKEN = (Get-Content infra\prometheus\metrics_token -Raw).Trim()
$env:GRAFANA_ADMIN_PASSWORD = "admin12345678"

# 2. Execute the verification suite
node scripts/e2e-observability.mjs
```

### What It Verifies Automatically:
1. **Bearer Token Authentication Security**: Proves `/metrics` rejects unauthenticated (`401`) and invalid-token requests across all 9 services.
2. **Prometheus Metrics Exposition**: Verifies default Node.js runtime and event-loop metrics on all 9 services.
3. **Custom Domain Metrics**:
   - `signaling-service` exposes `signaling_connected_sockets`.
   - `sfu-service` exposes Mediasoup worker metrics (`sfu_workers_*`).
   - `notification-service` & `recording-service` expose BullMQ queue metrics (`bullmq_jobs_*`).
4. **Cardinated Route Protection**: Checks that API Gateway collapses path parameters into fixed low-cardinality prefixes (`resolveGatewayRoute`).
5. **Prometheus Scrape Status**: Ensures Prometheus targets report `up` for all 9 services.
6. **Prometheus Alerting Rules**: Validates that all production alerts (`ServiceDown`, `HighHttpErrorRate`, etc.) are loaded.
7. **Jaeger Distributed Tracing**: Generates authenticated traffic (`signup` -> `login`) and asserts traces span both `api-gateway` and `auth-service` via W3C TraceContext propagation.
8. **Grafana Auto-Provisioning**: Asserts database health, verifies provisioned Prometheus and Jaeger datasources, and checks the presence of `video-meet-overview` dashboard.
9. **Failure Simulation & Chaos Testing**: Temporarily stops a downstream service (`chat-service`), verifies the Gateway converts failures to sanitized `502`/`504` errors without leaking internal hostnames, confirms Prometheus detects the service as `down`, confirms the `ServiceDown` alert fires, and restarts the service.

---

## 2. Port & Endpoint Reference Matrix

| Service | Port | Metric Route | Auth Required | Purpose / Telemetry Scope |
| :--- | :--- | :--- | :--- | :--- |
| **api-gateway** | `4000` | `/metrics` | `Bearer <TOKEN>` | Ingress request rate, route prefixes, proxy errors, rate limits |
| **auth-service** | `4001` | `/metrics` | `Bearer <TOKEN>` | User authentication, JWT issuance, database latencies |
| **user-service** | `4002` | `/metrics` | `Bearer <TOKEN>` | Profile lookups, user metadata queries |
| **room-service** | `4003` | `/metrics` | `Bearer <TOKEN>` | Room lifecycle, participant state, meeting scheduling |
| **signaling-service** | `4004` | `/metrics` | `Bearer <TOKEN>` | Real-time WebSocket connections, Socket.IO event throughput |
| **chat-service** | `4005` | `/metrics` | `Bearer <TOKEN>` | Meeting message storage, pagination latencies |
| **sfu-service** | `4006` | `/metrics` | `Bearer <TOKEN>` | Mediasoup workers, routers, peers, transports, RTP streams |
| **recording-service** | `4007` | `/metrics` | `Bearer <TOKEN>` | BullMQ recording queues, auto-stop tasks, composite downloads |
| **notification-service** | `4008` | `/metrics` | `Bearer <TOKEN>` | BullMQ email delivery queues, template render metrics |
| **Prometheus** | `9090` | `/api/v1/targets` | None | Scrape collector & alerting engine |
| **Grafana** | `3001` | `/` | `admin` / Password | Unified telemetry dashboards & analytics UI |
| **Jaeger** | `16686` | `/` | None | Distributed trace search, span dependency graphs |

---

## 3. Manual Step-by-Step Verification Procedure

If troubleshooting a specific service or validating outside of automated tests, perform these manual steps:

### Step 1: Verify Code Synchronization (Drift Detection)
Ensure all service copies of `shared/observability` match the source of truth:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-observability.ps1 -CheckOnly
```
*Expected output: `Observability files are fully in sync across all services. (0 drift detected)`*

---

### Step 2: Verify Container Health
Check that all 28 containers and volumes are active:
```bash
docker compose ps
```
*Expected: All 9 microservices, `prometheus`, `grafana`, `jaeger`, `redis`, `postgres`, `mongo`, `mailpit`, and `coturn` show `Up`.*

---

### Step 3: Test Metrics Endpoint & Bearer Security
Replace `$TOKEN` with the secret found in `infra/prometheus/metrics_token`:

```powershell
$TOKEN = (Get-Content infra\prometheus\metrics_token -Raw).Trim()

# 1. Test unauthenticated request (MUST return 401 Unauthorized)
curl -i http://localhost:4000/metrics

# 2. Test request with wrong token (MUST return 401 Unauthorized)
curl -i -H "Authorization: Bearer wrong-token" http://localhost:4000/metrics

# 3. Test request with valid Bearer token (MUST return 200 OK + Prometheus exposition format)
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/metrics
```

---

### Step 4: Verify Service-Specific Custom Metrics

#### A. API Gateway (`:4000`)
```powershell
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/metrics | Select-String "gateway_"
```
*Look for:*
- `gateway_proxy_errors_total{target="...",status="..."}`
- `gateway_rate_limit_hits_total{limiter="..."}`
- `http_requests_total{route="/api/auth",method="POST",status_code="200"}`

#### B. Signaling Service (`:4004`)
```powershell
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4004/metrics | Select-String "signaling_"
```
*Look for:*
- `signaling_connected_sockets <gauge>`
- `signaling_events_total{direction="in|out",event="..."}`

#### C. SFU Service (`:4006`)
```powershell
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4006/metrics | Select-String "sfu_"
```
*Look for:*
- `sfu_workers_active`
- `sfu_routers_active`
- `sfu_peers_active`
- `sfu_transports_active`
- `sfu_producers_active`
- `sfu_consumers_active`

#### D. BullMQ Queues (`recording-service:4007` & `notification-service:4008`)
```powershell
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4008/metrics | Select-String "bullmq_"
```
*Look for:*
- `bullmq_jobs_waiting{queue="email-queue"}`
- `bullmq_jobs_active{queue="email-queue"}`
- `bullmq_jobs_failed{queue="email-queue"}`
- `bullmq_jobs_completed{queue="email-queue"}`

---

### Step 5: Verify Prometheus Scraping & Alert Rules
Open **[http://localhost:9090](http://localhost:9090)** in your browser:

1. **Check Scrape Targets**: Navigate to `Status -> Targets` (or visit `http://localhost:9090/api/v1/targets`).
   - All 9 service endpoints must display state **UP** with blue badges.
2. **Check Alert Rules**: Navigate to `Alerts` (or visit `http://localhost:9090/api/v1/rules`).
   - Verify the 7 rules are active:
     - `ServiceDown`
     - `HighHttpErrorRate`
     - `HighHttpLatencyP95`
     - `ProxyErrorsSpike`
     - `RateLimitSaturation`
     - `BullMQFailedJobsAccumulating`
     - `SfuPeerLoadHigh`

---

### Step 6: Verify OpenTelemetry Distributed Tracing (Jaeger)
Open **[http://localhost:16686](http://localhost:16686)** in your browser:

1. Send an HTTP request that routes through the gateway to a downstream microservice:
   ```powershell
   # Create a test user through the Gateway
   $body = '{"email":"test-trace@example.com","password":"Password123!"}'
   Invoke-RestMethod -Uri "http://localhost:4000/api/auth/signup" -Method POST -ContentType "application/json" -Body $body
   ```
2. In Jaeger UI:
   - Select Service: **`api-gateway`**.
   - Click **Find Traces**.
   - Select the trace corresponding to `POST /api/auth/signup`.
   - Confirm the trace contains spans from both **`api-gateway`** and **`auth-service`**, linked by OpenTelemetry context propagation.

---

### Step 7: Verify Grafana Dashboards & Datasources
Open **[http://localhost:3001](http://localhost:3001)** in your browser:

1. Log in with `admin` and your configured password (`admin12345678` in `.env`).
2. Navigate to **Connections -> Data Sources**:
   - Verify **Prometheus** (`http://prometheus:9090`) is configured as the default datasource.
   - Verify **Jaeger** (`http://jaeger:16686`) is configured with trace-to-metrics navigation.
3. Navigate to **Dashboards**:
   - Open **Video Meet Platform Overview** (`video-meet-overview`).
   - Confirm all 10 panels display data without errors:
     1. System Health Overview
     2. Ingress Request Rate
     3. HTTP p95 Latency by Service
     4. HTTP 5xx Error Rates
     5. Gateway Proxy Errors & Rate Limits
     6. Signaling Active Sockets & Event Rates
     7. SFU Mediasoup Topologies
     8. BullMQ Queue Backlogs
     9. Notification Email Delivery Rates
     10. Distributed Tracing Deep-Link

---

### Step 8: Verify Structured Pino Log Correlation
Inspect live JSON logs from any service to ensure OpenTelemetry Trace & Span IDs are automatically injected:
```powershell
docker compose logs api-gateway --tail 5
```
*Expected log format:*
```json
{
  "level": 30,
  "time": 1793299774782,
  "pid": 1,
  "hostname": "700ac4cb2c2c",
  "trace_id": "9704bb526c246dfa87dc12f908a249c6",
  "span_id": "3861c6fc06369100",
  "req": { "method": "GET", "url": "/api/users/me" },
  "res": { "statusCode": 401 },
  "msg": "request completed"
}
```

---

## 4. Chaos & Failure Recovery Drill

Run this drill to confirm end-to-end resilience and alerting:

1. **Stop a downstream service**:
   ```bash
   docker compose stop chat-service
   ```
2. **Send a request through the Gateway**:
   ```powershell
   curl -i http://localhost:4000/api/v1/chat/test-room/messages
   ```
   *Expected response:*
   - Returns HTTP `502 Bad Gateway` or `504 Gateway Timeout`.
   - Returns client-safe JSON: `{"success":false,"error":"Service temporarily unavailable","requestId":"..."}`.
   - Does **NOT** expose internal hostnames (`chat-service`), IP addresses, or stack traces.
3. **Verify Prometheus Target**:
   - Check `http://localhost:9090/targets` -> `chat-service` changes state from `UP` to `DOWN`.
4. **Verify Alert**:
   - Check `http://localhost:9090/alerts` -> `ServiceDown` alert triggers for `chat-service`.
5. **Recover the service**:
   ```bash
   docker compose start chat-service
   ```
   - Target status returns to `UP` within 15 seconds.
   - Alert state transitions to `Resolved`.

---

## 5. Troubleshooting & Common Pitfalls

| Symptom | Probable Cause | Resolution |
| :--- | :--- | :--- |
| **`/metrics` returns 401 Unauthorized** | Missing or incorrect Bearer token in request. | Check `infra/prometheus/metrics_token` and pass `Authorization: Bearer <TOKEN>`. |
| **Prometheus target shows `DOWN`** | Microservice crashed or token mismatch. | Run `docker compose logs <service>` to check for crash logs. Verify `METRICS_BEARER_TOKEN` matches in both service env and Prometheus token file. |
| **No traces appear in Jaeger** | `OTEL_EXPORTER_OTLP_ENDPOINT` missing or wrong. | Ensure `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` is present in `docker-compose.yml` for all services. |
| **High cardinality metrics warning** | Raw path parameter passed into metric labels. | Ensure all route metrics in `api-gateway` use `resolveGatewayRoute(req)` instead of raw `req.url`. |
| **Grafana datasource test fails** | Internal docker networking issue. | Ensure datasource URLs in `datasources.yml` use Docker internal hostnames `http://prometheus:9090` and `http://jaeger:16686` (not `localhost`). |

