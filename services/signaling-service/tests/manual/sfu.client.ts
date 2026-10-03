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
 * STEP 2: join-room, then wait for "joined".
 *
 * STEP 3: Check the joined payload and the room mode.
 *         3a: "joined" must carry mode = "sfu" or "mesh".
 *         3b: a second join-room must be refused (join-error).
 *
 * STEP 4: Run the real SFU events through signaling.
 *         Every check prints PASS or FAIL.
 *
 * STEP 5: Print a summary, then stay alive.
 *         Press Ctrl+C to disconnect, then look at
 *         "docker compose logs sfu-service" for "Peer removed".
 *         A second client in the same room should log peer-left.
 */
const socket = io('http://localhost:4004', { auth: { token } });

let passed = 0;
let failed = 0;
let started = false; // a reconnect must not run the whole test twice

// ack helper with a 5s timeout so the script never hangs
const call = (event: string, payload: object = {}) =>
    new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, message: 'ack timeout' }), 5000);
        socket.emit(event, payload, (res: any) => { clearTimeout(timer); resolve(res); });
    });

// wait for ONE server push event, or undefined after the timeout
const waitFor = (event: string, ms = 3000) =>
    new Promise<any>((resolve) => {
        function onEvent(data: any) {
            clearTimeout(timer);
            resolve(data);
        }
        const timer = setTimeout(() => {
            socket.off(event, onEvent);
            resolve(undefined);
        }, ms);
        socket.once(event, onEvent);
    });

const expect = (name: string, ok: boolean, res?: any) => {
    ok ? passed++ : failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : JSON.stringify(res));
};

socket.on('connect', async () => {
    console.log(`[connected] socket.id = ${socket.id}`);

    if (started) return;
    started = true;

    // STEP 1
    const early = await call('get-router-capabilities');
    expect('before join -> 403', early.statusCode === 403, early);

    // STEP 2
    socket.emit('join-room', { roomCode });
});

socket.on('joined', async (data) => {
    console.log('[joined]', data);

    // STEP 3a
    expect('joined carries mode', data.mode === 'sfu' || data.mode === 'mesh', data);
    console.log(`  room mode = ${data.mode}`);

    // STEP 3b
    const refused = waitFor('join-error');
    socket.emit('join-room', { roomCode });
    const msg = await refused;
    expect('second join refused', typeof msg === 'string' && /Already in a room/.test(msg), msg);

    // STEP 4
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

    // STEP 5
    console.log(`--- ${passed} passed, ${failed} failed. Press Ctrl+C to test disconnect cleanup ---`);
});

// push events from the server
socket.on('peer-joined', (d) => console.log('[peer-joined]', d));
socket.on('peer-left', (d) => console.log('[peer-left]', d));
socket.on('new-producer', (d) => console.log('[new-producer]', d));
socket.on('producer-closed', (d) => console.log('[producer-closed]', d));
socket.on('join-error', (m) => console.log('[join-error]', m));
socket.on('connect_error', (e) => console.log('[connect_error]', e.message));

process.stdin.resume();