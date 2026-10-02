import { io } from 'socket.io-client';

// Usage: npx tsx tests/manual/sfu.client.ts <token> <roomCode>
const [token, roomCode] = process.argv.slice(2);

if (!token || !roomCode) {
    console.error('Usage: npx tsx tests/manual/sfu.client.ts <token> <roomCode>');
    process.exit(1);
}

/**
 * sfu.client.ts
 *
 * STEP 1: Connect, then call an SFU event BEFORE join-room.
 *         Expect 403 ("Join a room first").
 *
 * STEP 2: join-room, then run the real SFU events through signaling.
 *
 * STEP 3: Check each answer. A failed check prints FAIL.
 *
 * STEP 4: Stay alive. Press Ctrl+C to disconnect, then look at
 *         "docker compose logs sfu-service" for "Peer removed".
 *         A second client in the same room should log peer-left.
 */
const socket = io('http://localhost:4004', { auth: { token } });

// ack helper with a 5s timeout so the script never hangs
const call = (event: string, payload: object = {}) =>
    new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, message: 'ack timeout' }), 5000);
        socket.emit(event, payload, (res: any) => { clearTimeout(timer); resolve(res); });
    });

const expect = (name: string, ok: boolean, res: any) =>
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : JSON.stringify(res));

socket.on('connect', async () => {
    console.log(`[connected] socket.id = ${socket.id}`);

    // STEP 1
    let r = await call('get-router-capabilities');
    expect('before join -> 403', r.statusCode === 403, r);

    // STEP 2
    socket.emit('join-room', { roomCode });
});

socket.on('joined', async (data) => {
    console.log('[joined]', data);

    // STEP 3
    let r = await call('get-router-capabilities');
    expect('router capabilities', r.success === true, r);

    r = await call('create-transport', { direction: 'send' });
    expect('create send transport', r.success === true && !!r.data?.id, r);

    r = await call('create-transport', { direction: 'send' });
    expect('duplicate send transport -> 409', r.statusCode === 409, r);

    r = await call('create-transport', { direction: 'recv' });
    expect('create recv transport', r.success === true, r);

    r = await call('create-transport', { direction: 'sideways' });
    expect('bad direction -> 400', r.statusCode === 400, r);

    r = await call('get-producers');
    expect('get-producers (empty)', r.success === true && r.data.length === 0, r);

    r = await call('consume', { producerId: 'does-not-exist', rtpCapabilities: {} });
    expect('consume unknown producer -> 404', r.statusCode === 404, r);

    console.log('--- done. Press Ctrl+C to test disconnect cleanup ---');
});

// push events from the server
socket.on('peer-joined', (d) => console.log('[peer-joined]', d));
socket.on('peer-left', (d) => console.log('[peer-left]', d));
socket.on('new-producer', (d) => console.log('[new-producer]', d));
socket.on('producer-closed', (d) => console.log('[producer-closed]', d));
socket.on('join-error', (m) => console.log('[join-error]', m));
socket.on('connect_error', (e) => console.log('[connect_error]', e.message));

// STEP 4
process.stdin.resume();