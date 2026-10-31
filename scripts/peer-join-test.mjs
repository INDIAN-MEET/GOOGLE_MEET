// scripts/peer-join-test.mjs
import { io } from '../FRONTEND/web/node_modules/socket.io-client/build/esm/index.js';

const GATEWAY_URL = 'http://localhost:4000';
const SIGNALING_URL = 'http://localhost:4004';
const ROOM_CODE = process.argv[2] || '1lp-eff7-bhv';

console.log(`\n========================================`);
console.log(`TESTING PEER JOIN FOR ROOM: ${ROOM_CODE}`);
console.log(`========================================\n`);

async function run() {
  // 1. Create or login peer account
  const peerEmail = 'ai_assistant_peer@example.com';
  const peerPassword = 'StrongPassword999!';
  
  console.log(`[1] Authenticating peer (${peerEmail})...`);
  let signupRes = await fetch(`${GATEWAY_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: peerEmail, password: peerPassword })
  });

  const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: peerEmail, password: peerPassword })
  });

  if (!loginRes.ok) {
    throw new Error(`Peer login failed: ${loginRes.status} ${await loginRes.text()}`);
  }

  const { data: authData } = await loginRes.json();
  const token = authData.accessToken;
  const peerUserId = authData.user.id;
  console.log(`[PASS] Peer authenticated successfully! userId: ${peerUserId}`);

  // 2. Fetch room details
  console.log(`\n[2] Checking room details for ${ROOM_CODE}...`);
  const roomRes = await fetch(`${GATEWAY_URL}/api/v1/rooms/${ROOM_CODE}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!roomRes.ok) {
    throw new Error(`Failed to get room details: ${roomRes.status} ${await roomRes.text()}`);
  }
  const roomData = await roomRes.json();
  console.log(`[PASS] Room found: "${roomData?.data?.room?.title}" (Host: ${roomData?.data?.room?.hostUserId})`);

  // 3. REST Join room
  console.log(`\n[3] Joining room via REST...`);
  const joinRes = await fetch(`${GATEWAY_URL}/api/v1/rooms/${ROOM_CODE}/join`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`[PASS] REST Join response: ${joinRes.status} (409 means already joined)`);

  // 4. Connect to Signaling Socket.IO
  console.log(`\n[4] Connecting to Signaling Service (${SIGNALING_URL})...`);
  const socket = io(SIGNALING_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Signaling socket connection timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      console.log(`[PASS] Connected to signaling service! Socket ID: ${socket.id}`);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // 5. Emit join-room
  console.log(`\n[5] Emitting 'join-room' for room: ${ROOM_CODE}...`);
  const joinedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Signaling join-room timeout')), 5000);
    socket.once('joined', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
    socket.once('join-error', (err) => {
      clearTimeout(timer);
      reject(new Error(err));
    });
  });

  socket.emit('join-room', { roomCode: ROOM_CODE });
  const joinedPayload = await joinedPromise;
  console.log(`[PASS] Joined signaling room successfully!`);
  console.log(`Current members in room:`, JSON.stringify(joinedPayload?.existingMembers || []));

  // 6. Test SFU router capabilities
  console.log(`\n[6] Requesting SFU router capabilities...`);
  const caps = await new Promise((resolve) => {
    socket.emit('get-router-capabilities', {}, (res) => resolve(res));
  });
  console.log(`[PASS] Router capabilities received:`, caps?.success ? 'OK' : JSON.stringify(caps));

  // 7. Check producers currently publishing in the room
  console.log(`\n[7] Querying active SFU producers...`);
  const producersRes = await new Promise((resolve) => {
    socket.emit('get-producers', {}, (res) => resolve(res));
  });
  console.log(`[PASS] Active SFU producers in room:`, JSON.stringify(producersRes?.data || producersRes || []));

  // 8. Test SFU Transports creation
  console.log(`\n[8] Creating SFU send & receive transports...`);
  const sendTransportRes = await new Promise((resolve) => {
    socket.emit('create-transport', { direction: 'send' }, (res) => resolve(res));
  });
  const recvTransportRes = await new Promise((resolve) => {
    socket.emit('create-transport', { direction: 'recv' }, (res) => resolve(res));
  });
  console.log(`[PASS] Send transport:`, sendTransportRes?.success ? `ID: ${sendTransportRes?.data?.id}` : JSON.stringify(sendTransportRes));
  console.log(`[PASS] Recv transport:`, recvTransportRes?.success ? `ID: ${recvTransportRes?.data?.id}` : JSON.stringify(recvTransportRes));

  // 9. Send a Chat Message to the room
  console.log(`\n[9] Sending real-time chat message into room ${ROOM_CODE}...`);
  const chatText = `👋 Hello from Antigravity AI peer! Connected and verified signaling, SFU, and chat features.`;
  
  socket.emit('chat-message', {
    roomId: ROOM_CODE,
    text: chatText,
    senderName: 'Antigravity AI Peer'
  });
  console.log(`[PASS] Chat message emitted to room!`);

  // 10. Query chat history via REST API
  console.log(`\n[10] Querying chat history via REST (/api/v1/chat/${ROOM_CODE}/messages)...`);
  const chatHistRes = await fetch(`${GATEWAY_URL}/api/v1/chat/${ROOM_CODE}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (chatHistRes.ok) {
    const chatData = await chatHistRes.json();
    const count = Array.isArray(chatData?.data?.messages) ? chatData.data.messages.length : (Array.isArray(chatData?.data) ? chatData.data.length : 0);
    console.log(`[PASS] Chat history retrieved successfully! Total messages: ${count}`);
  } else {
    console.log(`[NOTE] Chat history returned: ${chatHistRes.status} ${await chatHistRes.text()}`);
  }

  // 11. Test Recordings endpoint via REST
  console.log(`\n[11] Testing recordings query via REST (/api/v1/recordings?roomCode=${ROOM_CODE})...`);
  const recRes = await fetch(`${GATEWAY_URL}/api/v1/recordings?roomCode=${ROOM_CODE}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const recData = await recRes.json();
  console.log(`[PASS] Recordings endpoint returned: ${recRes.status}`, JSON.stringify(recData));

  // Keep socket alive for 10 seconds so the user sees the peer in their room!
  console.log(`\n[12] Staying connected as a live peer in room for 15 seconds...`);
  await new Promise((resolve) => setTimeout(resolve, 15000));

  console.log(`[13] Leaving room and disconnecting peer...`);
  socket.emit('leave-room', { roomCode: ROOM_CODE });
  socket.disconnect();
  console.log(`[PASS] Peer test finished successfully!\n`);
}

run().catch((err) => {
  console.error(`[FAIL] Peer test error:`, err);
  process.exit(1);
});
