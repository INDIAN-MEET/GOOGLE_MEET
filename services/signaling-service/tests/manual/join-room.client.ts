import { io } from 'socket.io-client';

// Usage: npx tsx tests/manual/join-room.client.ts <token> <roomCode>
const [token, roomCode] = process.argv.slice(2);

if (!token || !roomCode) {
    console.error('Usage: npx tsx tests/manual/join-room.client.ts <token> <roomCode>');
    process.exit(1);
}

const socket = io('http://localhost:4004', {
    auth: { token },
});

socket.on('connect', () => {
    console.log(`[connected] socket.id = ${socket.id}`);
    socket.emit('join-room', { roomCode });
});

socket.on('joined', (data) => {
    console.log('[joined]', data);
});

socket.on('peer-joined', (data) => {
    console.log('[peer-joined]', data);
});

socket.on('peer-left', (data) => {
    console.log('[peer-left]', data);
});

socket.on('join-error', (msg) => {
    console.log('[join-error]', msg);
});

socket.on('offer', (data) => {
    console.log('[offer received]', data);
});

socket.on('answer', (data) => {
    console.log('[answer received]', data);
});

socket.on('ice-candidate', (data) => {
    console.log('[ice-candidate received]', data);
});

socket.on('connect_error', (err) => {
    console.log('[connect_error]', err.message);
});

// Keep process alive so it can receive events indefinitely.
// Ctrl+C to exit (this also triggers the server's 'disconnect' cleanup).
process.stdin.resume();