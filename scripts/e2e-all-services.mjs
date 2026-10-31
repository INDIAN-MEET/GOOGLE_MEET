// scripts/e2e-all-services.mjs
// Automated verification for all microservices through API Gateway + Frontend

const GATEWAY_URL = 'http://localhost:4000';
const FRONTEND_URL = 'http://localhost:5173';

async function testAll() {
  console.log('=== STARTING ALL SERVICES VERIFICATION ===\n');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(`[PASS] ${name} ${extra}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${extra}`);
      failed++;
    }
  }

  // 1. Gateway health
  try {
    const res = await fetch(`${GATEWAY_URL}/health`);
    const data = await res.json();
    assert('API Gateway /health', res.status === 200 && data.status === 'ok');
  } catch (err) {
    assert('API Gateway /health', false, err.message);
  }

  // 2. Gateway ready
  try {
    const res = await fetch(`${GATEWAY_URL}/ready`);
    const data = await res.json();
    assert('API Gateway /ready', res.status === 200 && data.status === 'ready');
  } catch (err) {
    assert('API Gateway /ready', false, err.message);
  }

  // 3. Frontend container
  try {
    const res = await fetch(`${FRONTEND_URL}/`);
    const text = await res.text();
    assert('Frontend Container HTTP 200', res.status === 200 && text.includes('<div id="root">'));
  } catch (err) {
    assert('Frontend Container HTTP 200', false, err.message);
  }

  // 4. Frontend SPA routing fallback
  try {
    const res = await fetch(`${FRONTEND_URL}/room/xyz-123-abc`);
    const text = await res.text();
    assert('Frontend SPA Routing Fallback', res.status === 200 && text.includes('<div id="root">'));
  } catch (err) {
    assert('Frontend SPA Routing Fallback', false, err.message);
  }

  // 5. Auth Service - Sign Up new random user
  const randomEmail = `user_${Date.now()}@example.com`;
  const password = 'StrongPassword123!';
  let userId = null;
  let accessToken = null;
  let refreshToken = null;

  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: randomEmail, password })
    });
    const data = await res.json();
    userId = data?.data?.userId;
    assert('Auth Service - Sign Up', res.status === 201 && !!userId, `(userId: ${userId})`);
  } catch (err) {
    assert('Auth Service - Sign Up', false, err.message);
  }

  // 6. Auth Service - Login
  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: randomEmail, password })
    });
    const data = await res.json();
    accessToken = data?.data?.accessToken;
    refreshToken = data?.data?.refreshToken;
    assert('Auth Service - Login', res.status === 200 && !!accessToken);
  } catch (err) {
    assert('Auth Service - Login', false, err.message);
  }

  // 7. Auth Service - /auth/me
  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    assert('Auth Service - /auth/me', res.status === 200 && data?.data?.userId === userId);
  } catch (err) {
    assert('Auth Service - /auth/me', false, err.message);
  }

  // 8. Auth Service - /auth/turn-credentials
  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/turn-credentials`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const iceServers = data?.data?.iceServers;
    assert('Auth Service - /auth/turn-credentials', res.status === 200 && Array.isArray(iceServers) && iceServers.length > 0);
  } catch (err) {
    assert('Auth Service - /auth/turn-credentials', false, err.message);
  }

  // 9. Room Service - Create Room
  let roomId = null;
  let roomCode = null;
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/rooms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Sprint Review Meeting' })
    });
    const data = await res.json();
    const room = data?.data?.room || data?.data || data;
    roomId = room?.id;
    roomCode = room?.code;
    assert('Room Service - Create Room', (res.status === 200 || res.status === 201) && !!roomCode, `(code: ${roomCode})`);
  } catch (err) {
    assert('Room Service - Create Room', false, err.message);
  }

  // 10. Room Service - Get Room by Code
  if (roomCode) {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/rooms/${roomCode}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const data = await res.json();
      const room = data?.data?.room || data?.data || data;
      const code = room?.code;
      assert('Room Service - Get Room by Code', res.status === 200 && code === roomCode, `(verified code: ${code})`);
    } catch (err) {
      assert('Room Service - Get Room by Code', false, err.message);
    }
  }

  // 11. User Service - Get Current User Profile
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    assert('User Service - /api/v1/users/me', (res.status === 200 || res.status === 404), `Status: ${res.status}`);
  } catch (err) {
    assert('User Service - /api/v1/users/me', false, err.message);
  }

  // 12. Signaling & SFU container health
  try {
    const sfuRes = await fetch('http://localhost:4006/health');
    const sfuData = await sfuRes.json();
    assert('SFU Service Direct Health (port 4006)', sfuRes.status === 200 && sfuData.status === 'ok');
  } catch (err) {
    assert('SFU Service Direct Health (port 4006)', false, err.message);
  }

  try {
    const sigRes = await fetch('http://localhost:4004/health');
    assert('Signaling Service Direct Health (port 4004)', sigRes.status === 200);
  } catch (err) {
    assert('Signaling Service Direct Health (port 4004)', false, err.message);
  }

  try {
    const recRes = await fetch('http://localhost:4007/health');
    assert('Recording Service Direct Health (port 4007)', recRes.status === 200);
  } catch (err) {
    assert('Recording Service Direct Health (port 4007)', false, err.message);
  }

  try {
    const chatRes = await fetch('http://localhost:4005/health');
    assert('Chat Service Direct Health (port 4005)', chatRes.status === 200);
  } catch (err) {
    assert('Chat Service Direct Health (port 4005)', false, err.message);
  }

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testAll().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
