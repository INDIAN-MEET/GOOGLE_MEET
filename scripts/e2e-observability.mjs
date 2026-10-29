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

