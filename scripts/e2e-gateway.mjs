#!/usr/bin/env node
/**
 * Phase 12 E2E test: API Gateway hardening.
 *
 * Run (gateway + redis + auth + chat services must be running in docker):
 *   node scripts/e2e-gateway.mjs
 *
 * Optional env:
 *   GATEWAY_URL                 default http://localhost:4000
 *   RATE_LIMIT_STANDARD_MAX     default 100 (must match the gateway setting)
 *   RATE_LIMIT_LOGIN_MAX        default 10  (must match the gateway setting)
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const STANDARD_MAX = Number(process.env.RATE_LIMIT_STANDARD_MAX ?? 100);
const LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10);
const PASSWORD = 'Password123!';

// ---------------------------------------------------------------- helpers ---
const results = [];

/** Runs one test, records and prints PASS/FAIL. A failing test never stops the script. */
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  FAIL  ${name}\n        -> ${err.message}`);
  }
}

/** Throws an Error with `message` when `condition` is false. */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a docker command. Uses execFile (no shell), so quoting works on Windows too. */
function docker(...args) {
  return execFileSync('docker', args, { stdio: 'pipe' }).toString();
}

/** Deletes all rate-limit keys so every run starts from zero. */
function flushRateLimits() {
  docker('exec', 'redis', 'sh', '-c', "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del");
}

/**
 * Sends one request to the gateway.
 * @returns {{status:number, headers:Headers, text:string, json:any}}
 */
async function call(path, { method = 'GET', token, headers = {}, body, rawBody } = {}) {
  const finalHeaders = { ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  let payload = rawBody;
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (rawBody !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: finalHeaders,
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Polls `fn` until it returns true or `timeoutMs` passes. */
async function waitFor(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {
      /* keep waiting */
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/** Creates a user and logs in. @returns {Promise<string>} access token */
async function createUser(tag) {
  const email = `e2e-${Date.now()}-${tag}@example.com`;
  const signup = await call('/api/auth/signup', { method: 'POST', body: { email, password: PASSWORD } });
  assert(signup.status === 201, `signup ${tag} expected 201, got ${signup.status}: ${signup.text}`);
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert(login.status === 200, `login ${tag} expected 200, got ${login.status}: ${login.text}`);
  const token = login.json?.data?.accessToken;
  assert(token, `login ${tag} returned no accessToken`);
  return token;
}

// ------------------------------------------------------------------- run ----
console.log(`\nGateway E2E against ${BASE}\n`);
flushRateLimits();

let tokenA;
let tokenB;

console.log('1. Probes');
await test('GET /health returns 200', async () => {
  const r = await call('/health');
  assert(r.status === 200, `got ${r.status}`);
  assert(r.json?.status === 'ok', 'body.status should be "ok"');
});
await test('GET /ready returns 200 when Redis is up', async () => {
  const r = await call('/ready');
  assert(r.status === 200, `got ${r.status}: ${r.text}`);
});

console.log('\n2. 404 and request id');
await test('Unknown route returns JSON 404 with requestId', async () => {
  const r = await call('/api/does-not-exist');
  assert(r.status === 404, `got ${r.status}`);
  assert(r.json?.success === false && r.json?.error === 'Route not found', `bad body: ${r.text}`);
  assert(r.json?.requestId, 'body.requestId missing');
});
await test('A valid x-request-id is echoed back', async () => {
  const id = 'e2e-request-12345678';
  const r = await call('/api/does-not-exist', { headers: { 'x-request-id': id } });
  assert(r.headers.get('x-request-id') === id, `header was ${r.headers.get('x-request-id')}`);
});
await test('An invalid x-request-id is replaced', async () => {
  const r = await call('/api/does-not-exist', { headers: { 'x-request-id': 'bad id with spaces!!' } });
  const got = r.headers.get('x-request-id');
  assert(got && got !== 'bad id with spaces!!', `header was ${got}`);
});

console.log('\n3. Body handling');
await test('Invalid JSON returns 400 (not 500)', async () => {
  const r = await call('/api/v1/rooms', { method: 'POST', rawBody: '{bad json' });
  assert(r.status === 400, `got ${r.status}: ${r.text}`);
});
await test('Body over the limit returns 413', async () => {
  const r = await call('/api/v1/rooms', { method: 'POST', body: { title: 'x'.repeat(200_000) } });
  assert(r.status === 413, `got ${r.status}: ${r.text}`);
});

console.log('\n4. Normal flow within quota');
await test('Signup + login for two users', async () => {
  tokenA = await createUser('a');
  tokenB = await createUser('b');
});
await test('GET /api/auth/me passes through and has RateLimit headers', async () => {
  const r = await call('/api/auth/me', { token: tokenA });
  assert(r.status === 200, `got ${r.status}: ${r.text}`);
  assert(r.headers.get('ratelimit'), 'RateLimit header missing');
});
await test('Protected route without token returns 401', async () => {
  const r = await call('/api/auth/me');
  assert(r.status === 401, `got ${r.status}`);
});

console.log('\n5. Downstream service offline (chat-service)');
try {
  docker('stop', 'chat-service');
  await test('Offline service gives sanitized 502/504', async () => {
    const r = await call('/api/v1/chat/room1/messages', { token: tokenA });
    assert([502, 504].includes(r.status), `expected 502/504, got ${r.status}: ${r.text}`);
    assert(r.json?.success === false, 'body.success should be false');
    for (const secret of ['chat-service', ':4005', 'ECONNREFUSED', 'ENOTFOUND', 'getaddrinfo']) {
      assert(!r.text.includes(secret), `response leaks "${secret}": ${r.text}`);
    }
    assert(!/\n\s+at /.test(r.text), 'response contains a stack trace');
    assert(r.headers.get('retry-after'), 'Retry-After header missing');
  });
} finally {
  docker('start', 'chat-service');
}

console.log('\n6. Standard tier (per user)');
await test(`Request number ${STANDARD_MAX + 1} gets 429 with Retry-After`, async () => {
  let firstBlocked = null;
  for (let i = 1; i <= STANDARD_MAX + 5; i++) {
    const r = await call('/api/auth/me', { token: tokenB });
    if (r.status === 429) {
      firstBlocked = { index: i, res: r };
      break;
    }
  }
  assert(firstBlocked, `no 429 after ${STANDARD_MAX + 5} requests`);
  assert(firstBlocked.res.headers.get('retry-after'), 'Retry-After header missing');
  assert(
    firstBlocked.res.json?.error === 'Too many requests. Please try again later.',
    `wrong body: ${firstBlocked.res.text}`,
  );
});

console.log('\n7. Auth tier (per IP, failed logins only)');
await test(`Failed login number ${LOGIN_MAX + 1} gets 429`, async () => {
  const statuses = [];
  let last;
  for (let i = 1; i <= LOGIN_MAX + 1; i++) {
    last = await call('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'wrong-password' },
    });
    statuses.push(last.status);
  }
  assert(statuses.slice(0, LOGIN_MAX).every((s) => s !== 429), `blocked too early: ${statuses.join(',')}`);
  assert(last.status === 429, `last status was ${last.status}`);
  assert(last.headers.get('retry-after'), 'Retry-After header missing');
  assert(
    last.json?.success === false && last.json?.error === 'Too many requests. Please try again later.',
    `wrong body: ${last.text}`,
  );
});

console.log('\n8. Redis offline');
flushRateLimits(); // fresh counters (token A is still valid, the limiter keys are new)
try {
  docker('stop', 'redis');
  await test('/ready returns 503 and /health still returns 200', async () => {
    const ready = await call('/ready');
    const health = await call('/health');
    assert(ready.status === 503, `/ready got ${ready.status}`);
    assert(health.status === 200, `/health got ${health.status}`);
  });
  await test('Login fails CLOSED (503) while Redis is down', async () => {
    const r = await call('/api/auth/login', { method: 'POST', body: { email: 'a@b.com', password: 'x' } });
    assert(r.status === 503, `got ${r.status}: ${r.text}`);
  });
  await test('Normal API fails OPEN (200) while Redis is down', async () => {
    const r = await call('/api/auth/me', { token: tokenA });
    assert(r.status === 200, `got ${r.status}: ${r.text}`);
  });
} finally {
  docker('start', 'redis');
}
await test('Gateway becomes ready again after Redis returns', async () => {
  await waitFor(async () => (await call('/ready')).status === 200, 30_000, '/ready = 200');
});

// ----------------------------------------------------------------- summary --
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
