import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import jwt from 'jsonwebtoken';

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:4000';
const SECONDS = Number(process.env.RECORD_SECONDS || 20);
const roomCode = process.argv[2];
if (!roomCode || !process.env.JWT_ACCESS_SECRET) {
  console.error('Usage: JWT_ACCESS_SECRET=... HOST_USER_ID=... node scripts/e2e-recording.mjs <roomCode>');
  process.exit(1);
}
const token = jwt.sign({ userId: process.env.HOST_USER_ID || 'host-123' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1h' });

/**
 * Waits for a number of milliseconds.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the gateway recordings API with the host token.
 *
 * @param {string} method - HTTP method.
 * @param {string} path - Path after /api/v1/recordings.
 * @param {object} [body] - Optional JSON body.
 * @returns {Promise<{status: number, json: any}>} Status code and parsed JSON.
 */
async function api(method, path, body) {
  const res = await fetch(`${GATEWAY}/api/v1/recordings${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/**
 * Runs the whole flow: start, record, stop, wait for READY, download, Range check.
 * The room must already contain a peer producing media (see the Chrome fake-device step).
 *
 * @returns {Promise<void>} Resolves when all checks pass, otherwise exits with code 1.
 */
async function main() {
  const start = await api('POST', '/start', { roomCode });
  console.log('START', start.status, JSON.stringify(start.json));
  if (start.status !== 201) process.exit(1);
  const id = start.json.data.recordingId;

  const again = await api('POST', '/start', { roomCode });
  console.log('START AGAIN (expect 409)', again.status);

  console.log(`Recording ${SECONDS}s ...`);
  await sleep(SECONDS * 1000);
  const stop = await api('POST', `/${id}/stop`);
  console.log('STOP (expect 202)', stop.status);

  let status = 'STOPPING';
  for (let i = 0; i < 150 && !['READY', 'FAILED'].includes(status); i += 1) {
    await sleep(2000);
    const detail = await api('GET', `/${id}`);
    status = detail.json?.data?.recording?.status ?? status;
    console.log('STATUS', status);
  }
  if (status !== 'READY') {
    console.error('Recording did not reach READY:', status);
    process.exit(1);
  }

  const out = `recording-${id}.mp4`;
  const res = await fetch(`${GATEWAY}/api/v1/recordings/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  console.log('DOWNLOAD', res.status, res.headers.get('content-type'));
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));

  const range = await fetch(`${GATEWAY}/api/v1/recordings/${id}/download`, {
    headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-99' },
  });
  console.log('RANGE (expect 206)', range.status, range.headers.get('content-range'));
  console.log(`OK. Check it with: ffprobe -hide_banner ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
