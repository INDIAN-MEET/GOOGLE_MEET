// scripts/test-recording-stop.mjs
const GATEWAY_URL = 'http://localhost:4000';

async function test() {
  console.log('=== TESTING RECORDING START AND STOP (BOTH BY ID AND BY ROOMCODE) ===');

  // 1. Auth host
  const email = `host_rec_${Date.now()}@example.com`;
  const password = 'Password123!';
  await fetch(`${GATEWAY_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const { data: authData } = await loginRes.json();
  const token = authData.accessToken;
  console.log('[PASS] Host authenticated:', authData.user.id);

  // 2. Create Room
  const roomRes = await fetch(`${GATEWAY_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ title: 'Recording Test Room' })
  });
  const { data: roomData } = await roomRes.json();
  const roomCode = roomData.room.code;
  console.log('[PASS] Room created:', roomCode);

  // 3. Start Recording
  console.log('[Test 1] Starting recording...');
  const startRes = await fetch(`${GATEWAY_URL}/api/v1/recordings/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ roomCode })
  });
  const startJson = await startRes.json();
  console.log('Start response status:', startRes.status, JSON.stringify(startJson));
  if (!startRes.ok) throw new Error('Start failed');
  const recordingId = startJson.data.id || startJson.data.recordingId;
  console.log('[PASS] Recording started with ID:', recordingId);

  // 4. Test STOPPING BY ROOMCODE (the exact bug the user hit!)
  console.log(`[Test 2] Stopping recording using ROOM CODE (${roomCode})...`);
  const stopByRoomRes = await fetch(`${GATEWAY_URL}/api/v1/recordings/${roomCode}/stop`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const stopByRoomJson = await stopByRoomRes.json();
  console.log('Stop by roomCode status:', stopByRoomRes.status, JSON.stringify(stopByRoomJson));
  if (stopByRoomRes.status !== 202) {
    throw new Error(`Stop by roomCode failed with status ${stopByRoomRes.status}`);
  }
  console.log('[PASS] Stopped successfully using ROOM CODE!');

  // Wait 2 seconds
  await new Promise(r => setTimeout(r, 2000));

  // 5. Start a second recording and stop by UUID
  console.log('\n[Test 3] Starting second recording...');
  const startRes2 = await fetch(`${GATEWAY_URL}/api/v1/recordings/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ roomCode })
  });
  const startJson2 = await startRes2.json();
  const recordingId2 = startJson2.data.id || startJson2.data.recordingId;
  console.log('[PASS] Second recording started with ID:', recordingId2);

  console.log(`[Test 4] Stopping recording using UUID (${recordingId2})...`);
  const stopByIdRes = await fetch(`${GATEWAY_URL}/api/v1/recordings/${recordingId2}/stop`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const stopByIdJson = await stopByIdRes.json();
  console.log('Stop by UUID status:', stopByIdRes.status, JSON.stringify(stopByIdJson));
  if (stopByIdRes.status !== 202) {
    throw new Error(`Stop by UUID failed with status ${stopByIdRes.status}`);
  }
  console.log('[PASS] Stopped successfully using UUID!');

  console.log('\n======================================================');
  console.log('RECORDING START AND STOP VERIFIED 100% WORKING!');
  console.log('======================================================');
}

test().catch(e => {
  console.error('[FAIL]', e);
  process.exit(1);
});
