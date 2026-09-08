/**
 * Phase 6 — Minimal WebRTC Test Client
 * ─────────────────────────────────────
 * Diagnostic tool. One plain HTML+JS file.
 * No React, no build step, no bundler.
 *
 * Purpose: prove that the Signaling Service built in Phase 5 can carry
 * a real RTCPeerConnection handshake (real SDP offer/answer + real ICE
 * candidates) all the way to live audio/video between two browser tabs.
 *
 * Architecture note:
 *   Socket.io ──► Signaling :4004  (control plane — signaling only)
 *   RTCPeerConnection ──────────►  (media plane  — direct P2P UDP, bypasses gateway)
 *
 * Connection flow (Section 5 of Phase 6 plan):
 *   Tab A joins → gets existingMembers:[]  → waits
 *   Tab B joins → Tab A gets 'peer-joined' → Tab A sends offer
 *   Tab B receives offer → sends answer → both exchange ICE → media flows
 *
 * Phase 7 addition:
 *   Before creating any RTCPeerConnection, we fetch short-lived TURN/STUN
 *   credentials from Auth Service (via Gateway) and pass them in as
 *   iceServers. This lets calls succeed even across restrictive NATs where
 *   a direct P2P connection isn't possible.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const localVideo        = document.getElementById('localVideo');
const remoteVideo       = document.getElementById('remoteVideo');
const localPlaceholder  = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remotePlaceholder');
const joinBtn           = document.getElementById('joinBtn');
const leaveBtn          = document.getElementById('leaveBtn');
const statusBadge       = document.getElementById('statusBadge');
const logOutput         = document.getElementById('logOutput');
const remoteIceIndicator = document.getElementById('remoteIceIndicator');

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
/** @type {MediaStream|null} */
let localStream = null;

/** @type {RTCPeerConnection|null} — one instance for this 2-person test */
let pc = null;

/** @type {import('socket.io-client').Socket|null} */
let socket = null;

/**
 * Cached ICE servers (STUN + TURN) fetched once at join time.
 * Fetched fresh each time user clicks "Join Call" since credentials expire.
 * @type {RTCIceServer[]|null}
 */
let cachedIceServers = null;

/**
 * The socket ID of the remote peer we are currently connected to.
 * Needed for ICE candidate routing even after the peer-joined event has
 * already fired and we've moved on to offer/answer phase.
 * @type {string|null}
 */
let remoteSocketId = null;

/** Whether this tab is the one that should initiate the offer (Section 5.2) */
let shouldInitiate = false;

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING (replaces console.log for on-screen feedback)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {'info'|'success'|'warn'|'error'} level
 * @param {string} message
 */
function log(level, message) {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;

    // Also mirror to the real console for DevTools / Network inspector debugging
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[${ts}] [${level.toUpperCase()}] ${message}`);

    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.innerHTML = `<span class="ts">${ts}</span><span class="tag-${level}">[${level.toUpperCase()}]</span><span class="msg">${escapeHtml(message)}</span>`;
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {'idle'|'connected'|'calling'|'live'|'error'} state
 * @param {string} label
 */
function setStatus(state, label) {
    statusBadge.className = state;
    statusBadge.textContent = label;
}

// ─────────────────────────────────────────────────────────────────────────────
// T.3 — getUserMedia: request camera + mic from the OS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Requests camera + mic access and attaches the stream to the local <video>.
 * Must be called before createPeerConnection() so tracks are available for
 * addTrack().
 * @returns {Promise<void>}
 */
async function getMedia() {
    log('info', 'Requesting camera + mic via getUserMedia()…');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localPlaceholder.style.display = 'none';
        log('success', `getUserMedia() granted — ${localStream.getTracks().length} tracks (video + audio)`);
    } catch (err) {
        log('error', `getUserMedia() failed: ${err.name} — ${err.message}`);
        log('warn', 'If you see "NotAllowedError", grant browser camera/mic permission and reload.');
        log('warn', 'If you see "NotReadableError" over file://, serve via: npx serve . and open http://localhost:3000');
        setStatus('error', 'Camera denied');
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7 — Fetch TURN/STUN credentials from Auth Service (via Gateway)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fetches short-lived TURN/STUN credentials from Auth Service.
 * Must be called fresh before each RTCPeerConnection — credentials
 * expire after 10 minutes.
 * @param {string} token — JWT access token
 * @returns {Promise<RTCIceServer[]>}
 */
async function getIceServers(token) {
    log('info', 'Fetching TURN/STUN credentials from Auth Service…');
    try {
        const res = await fetch('http://localhost:4000/api/v1/auth/turn-credentials', {
            headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();

        if (!json.success) {
            throw new Error('Server returned success:false');
        }

        log('success', `Got ${json.data.iceServers.length} ICE server(s) — STUN + TURN ready`);
        return json.data.iceServers;
    } catch (err) {
        log('error', `getIceServers() failed: ${err.message}`);
        log('warn', 'Falling back to public Google STUN only (no TURN relay available)');
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// T.4 — Socket.io connection to Signaling Service
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Opens a Socket.io connection to the Signaling Service on :4004.
 * Auth token is passed in the handshake so socketAuth.ts middleware can
 * validate it (same mechanism as Phase 5 tests).
 *
 * Why :4004 and not the Gateway: WebSocket traffic bypasses the Gateway by
 * design — this matches the architecture doc and Phase 5 test scripts.
 *
 * @param {string} token — JWT access token from Auth Service
 * @returns {Promise<void>} resolves once the socket emits 'connect'
 */
function connectSocket(token) {
    return new Promise((resolve, reject) => {
        log('info', 'Connecting to Signaling Service at ws://localhost:4004 …');

        socket = io('http://localhost:4004', {
            auth: { token },
            // Explicit transports list — avoids initial polling fallback which
            // can mask connection errors during dev
            transports: ['websocket'],
        });

        socket.on('connect', () => {
            log('success', `Socket connected — ID: ${socket.id}`);
            setStatus('connected', `Connected · ${socket.id.slice(0, 8)}…`);
            resolve();
        });

        socket.on('connect_error', (err) => {
            log('error', `connect_error: ${err.message}`);
            log('warn', 'Check: Is the Signaling Service running? Is the token valid?');
            setStatus('error', 'Connect failed');
            reject(err);
        });

        socket.on('disconnect', (reason) => {
            log('warn', `Socket disconnected — reason: ${reason}`);
            setStatus('idle', 'Disconnected');
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// T.5 — join-room + reacting to joined / peer-joined
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Emits 'join-room' and registers the event handlers that kick off the
 * WebRTC handshake.
 *
 * Convention (Section 5.2 of the plan):
 *   - The peer that receives 'peer-joined' is the CALLER — it sends the offer.
 *   - The peer that was already in the room when the other joined is the CALLEE.
 *   This avoids the "glare" problem (two simultaneous offers colliding).
 *
 * @param {string} roomCode
 */
function joinRoom(roomCode) {
    log('info', `Emitting join-room for roomCode: ${roomCode}`);
    socket.emit('join-room', { roomCode });

    // ── 'joined' — server confirms we're in, sends the list of existing peers ──
    socket.on('joined', ({ existingMembers }) => {
        log('info', `'joined' received — existingMembers: [${existingMembers.join(', ') || 'none'}]`);

        if (existingMembers.length === 0) {
            log('info', 'First to join — waiting for a peer…');
            setStatus('connected', 'Waiting for peer…');
        } else {
            // Edge case: if someone was already there AND we somehow missed
            // peer-joined (shouldn't happen with our flow, but guard anyway).
            log('warn', `Room already has ${existingMembers.length} member(s). Waiting for peer-joined event to initiate.`);
        }
    });

    // ── 'peer-joined' — a new peer entered; WE are the caller ──
    socket.on('peer-joined', async ({ socketId, userId }) => {
        log('info', `'peer-joined' — socketId: ${socketId}, userId: ${userId}`);
        log('info', 'We received peer-joined ⟹ we are the CALLER. Initiating offer…');
        remoteSocketId = socketId;
        shouldInitiate = true;
        setStatus('calling', 'Calling…');
        await startCall(socketId);
    });

    // ── 'offer' — the other peer sent us an offer; WE are the callee ──
    socket.on('offer', async ({ fromSocketId, sdp }) => {
        log('info', `'offer' received from ${fromSocketId}`);
        log('info', `SDP type: ${sdp.type} | SDP starts with: ${String(sdp.sdp).slice(0, 40)}…`);
        remoteSocketId = fromSocketId;
        setStatus('calling', 'Answering…');
        await handleOffer(fromSocketId, sdp);
    });

    // ── 'answer' — the callee replied with an answer ──
    socket.on('answer', async ({ fromSocketId, sdp }) => {
        log('info', `'answer' received from ${fromSocketId}`);
        log('info', `SDP type: ${sdp.type}`);
        await handleAnswer(sdp);
    });

    // ── 'ice-candidate' — trickle ICE from the remote peer ──
    socket.on('ice-candidate', async ({ fromSocketId, candidate }) => {
        log('info', `'ice-candidate' from ${fromSocketId} — protocol: ${candidate.protocol || '?'}`);
        await handleIceCandidate(candidate);
    });

    // ── Server-side join errors (bad room, expired, etc.) ──
    socket.on('join-error', (msg) => {
        log('error', `join-error from server: ${msg}`);
        setStatus('error', 'Join failed');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// T.6 — RTCPeerConnection factory
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Creates and returns a new RTCPeerConnection with:
 *   - ICE servers (STUN + TURN) fetched from Auth Service (Phase 7) and
 *     cached at join time — passed in as the `iceServers` argument, NOT
 *     hardcoded, so credentials rotate correctly on every fresh join.
 *   - All local media tracks added via addTrack() BEFORE createOffer/createAnswer,
 *     so the tracks are included in the SDP negotiation.
 *   - ICE candidate trickle via onicecandidate → socket.emit('ice-candidate').
 *   - ontrack wired to the remote <video> element.
 *   - iceConnectionState wired to the on-screen indicator dot + status badge,
 *     so a TURN-relay fallback is visible in the UI, not just DevTools.
 *
 * @param {string} targetSocketId — the peer we're connecting to; used for ICE routing
 * @param {RTCIceServer[]} iceServers — STUN + TURN servers from getIceServers()
 * @returns {RTCPeerConnection}
 */
function createPeerConnection(targetSocketId, iceServers) {
    log('info', `Creating RTCPeerConnection — target: ${targetSocketId}`);
    log('info', `Using ${iceServers.length} ICE server(s): ${iceServers.map(s => s.urls).join(', ')}`);

    const peer = new RTCPeerConnection({ iceServers });

    // Add local tracks BEFORE any offer/answer is created, so they're
    // included in the SDP negotiation.
    if (localStream) {
        localStream.getTracks().forEach((track) => {
            peer.addTrack(track, localStream);
        });
        log('info', `Added ${localStream.getTracks().length} local track(s) to peer connection`);
    } else {
        log('warn', 'createPeerConnection(): localStream is null — no tracks added. Call getMedia() first.');
    }

    // Trickle ICE — every candidate the browser discovers gets relayed to
    // the other peer through the Signaling Service immediately.
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            log('info', `Local ICE candidate found (${event.candidate.type || '?'}) — sending to ${targetSocketId}`);
            socket.emit('ice-candidate', {
                targetSocketId,
                candidate: event.candidate,
            });
        } else {
            log('info', 'ICE candidate gathering complete (null candidate marks end-of-candidates)');
        }
    };

    // Remote media arrives here — attach it to the remote <video> element.
    peer.ontrack = (event) => {
        log('success', `ontrack fired — attaching remote stream (${event.streams[0]?.id})`);
        remoteVideo.srcObject = event.streams[0];
        remotePlaceholder.style.display = 'none';
    };

    // Drives the small indicator dot on the remote video card, and flips
    // the header status badge to "Live" once media is actually flowing.
    peer.oniceconnectionstatechange = () => {
        log('info', `iceConnectionState: ${peer.iceConnectionState}`);

        switch (peer.iceConnectionState) {
            case 'checking':
                remoteIceIndicator.className = 'ice-indicator checking';
                break;
            case 'connected':
            case 'completed':
                remoteIceIndicator.className = 'ice-indicator connected';
                setStatus('live', '🔴 Live');
                break;
            case 'failed':
                remoteIceIndicator.className = 'ice-indicator failed';
                setStatus('error', 'Connection failed');
                log('error', 'ICE connection failed — on a restrictive network this usually means TURN relay was needed but unreachable.');
                break;
            case 'disconnected':
                remoteIceIndicator.className = 'ice-indicator';
                break;
        }
    };

    peer.onconnectionstatechange = () => {
        log('info', `connectionState: ${peer.connectionState}`);
    };

    return peer;
}

// ─────────────────────────────────────────────────────────────────────────────
// T.7 — Initiating the offer (caller side)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Called by the peer that received 'peer-joined'.
 * Creates the RTCPeerConnection, generates a real SDP offer, sets it as the
 * local description, and sends it through the Signaling Service relay.
 *
 * @param {string} targetSocketId
 */
async function startCall(targetSocketId) {
    log('info', `startCall() → creating offer for ${targetSocketId}`);

    pc = createPeerConnection(targetSocketId, cachedIceServers);

    try {
        const offer = await pc.createOffer();
        log('info', `Offer created — SDP length: ${offer.sdp.length} chars`);

        await pc.setLocalDescription(offer);
        log('info', 'setLocalDescription(offer) done');

        socket.emit('offer', { targetSocketId, sdp: offer });
        log('success', `Offer emitted to Signaling Service → targeting ${targetSocketId}`);
    } catch (err) {
        log('error', `startCall() error: ${err.name} — ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// T.8 — Handling an incoming offer (callee side → creates the answer)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Called when the server relays an 'offer' event to this tab.
 * Sets the remote description, creates an answer, sets the local description,
 * and emits the answer back through the Signaling Service.
 *
 * @param {string} fromSocketId
 * @param {RTCSessionDescriptionInit} sdp
 */
async function handleOffer(fromSocketId, sdp) {
    log('info', `handleOffer() — creating RTCPeerConnection as callee`);

    pc = createPeerConnection(fromSocketId, cachedIceServers);

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        log('info', 'setRemoteDescription(offer) done');

        const answer = await pc.createAnswer();
        log('info', `Answer created — SDP length: ${answer.sdp.length} chars`);

        await pc.setLocalDescription(answer);
        log('info', 'setLocalDescription(answer) done');

        socket.emit('answer', { targetSocketId: fromSocketId, sdp: answer });
        log('success', `Answer emitted to Signaling Service → targeting ${fromSocketId}`);
    } catch (err) {
        log('error', `handleOffer() error: ${err.name} — ${err.message}`);
        log('warn', 'A setRemoteDescription error usually means the SDP was mangled in the relay. Check that relay.ts forwards the payload untouched (no double JSON.stringify).');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// T.9 — Handling the answer (caller side)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Called when the server relays an 'answer' event back to the caller.
 * Completes the SDP negotiation by setting the remote description.
 *
 * @param {RTCSessionDescriptionInit} sdp
 */
async function handleAnswer(sdp) {
    log('info', `handleAnswer() — applying remote description`);

    if (!pc) {
        log('error', 'handleAnswer(): pc is null — offer was never created or pc was reset');
        return;
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        log('success', 'setRemoteDescription(answer) done — SDP negotiation complete. Awaiting ICE…');
    } catch (err) {
        log('error', `handleAnswer() error: ${err.name} — ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// T.10 — Handling incoming ICE candidates
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Called each time the server relays an 'ice-candidate' event.
 * Adds the candidate to the local RTCPeerConnection.
 * Errors are caught and logged rather than thrown — a single bad candidate
 * won't break the session (the browser may have others that work).
 *
 * @param {RTCIceCandidateInit} candidate
 */
async function handleIceCandidate(candidate) {
    if (!pc) {
        log('warn', 'handleIceCandidate(): pc is null — skipping candidate (race condition?)');
        return;
    }

    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log('info', `addIceCandidate OK — foundation: ${candidate.foundation || '?'}`);
    } catch (err) {
        // Common cause: candidate arrived before setRemoteDescription finished.
        // In a production app you'd queue these; for this test client it's fine
        // to just log and continue — the connection usually succeeds anyway.
        log('error', `addIceCandidate error: ${err.name} — ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE / CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Tears down the RTCPeerConnection, stops all local media tracks, and emits
 * 'leave-room' so the Signaling Service's disconnect handler can run cleanup.
 * This is the manual "Leave" path; the window.beforeunload handler below
 * covers accidental tab closes.
 */
function leaveCall() {
    log('info', 'leaveCall() — tearing down connection…');

    if (socket) {
        socket.emit('leave-room', {});
        socket.disconnect();
        socket = null;
    }

    if (pc) {
        pc.close();
        pc = null;
    }

    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }

    cachedIceServers = null;

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    localPlaceholder.style.display = '';
    remotePlaceholder.style.display = '';
    remoteIceIndicator.className = 'ice-indicator';

    joinBtn.disabled = false;
    leaveBtn.style.display = 'none';
    setStatus('idle', 'Idle');
    log('success', 'Disconnected and cleaned up.');
}

// T.12 — Courtesy cleanup on tab close
// The Signaling Service's disconnect handler (Phase 5, D.10) already runs
// cleanup on any socket disconnect, so this is an optimization, not a
// requirement.
window.addEventListener('beforeunload', () => {
    if (socket) socket.emit('leave-room', {});
    if (pc)     pc.close();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
});

// ─────────────────────────────────────────────────────────────────────────────
// T.11 — Wire buttons
// ─────────────────────────────────────────────────────────────────────────────

// Join Call button
joinBtn.addEventListener('click', async () => {
    const token    = document.getElementById('token').value.trim();
    const roomCode = document.getElementById('roomCode').value.trim();

    if (!token) {
        log('error', 'Please paste an access token before joining.');
        return;
    }
    if (!roomCode) {
        log('error', 'Please enter a room code before joining.');
        return;
    }

    joinBtn.disabled = true;
    leaveBtn.style.display = 'inline-flex';

    try {
        // Step 1: camera + mic
        await getMedia();

        // Step 2: fetch TURN/STUN credentials (Phase 7) — must happen before
        // any RTCPeerConnection is created, since both startCall() and
        // handleOffer() read from cachedIceServers.
        cachedIceServers = await getIceServers(token);

        // Step 3: socket connection
        await connectSocket(token);

        // Step 4: join room — event handlers for the WebRTC flow are registered here
        joinRoom(roomCode);

    } catch (err) {
        log('error', `Join failed: ${err.message}`);
        joinBtn.disabled = false;
        leaveBtn.style.display = 'none';
    }
});

// Leave button
leaveBtn.addEventListener('click', leaveCall);

// Clear log button
document.getElementById('clearLog').addEventListener('click', () => {
    logOutput.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP LOG
// ─────────────────────────────────────────────────────────────────────────────
log('info', '=== WebRTC Test Client — Phase 6 + Phase 7 (TURN/STUN) ===');
log('info', 'Paste JWT access token + room code, then click "Join Call".');
log('info', 'Open a second tab with a DIFFERENT user token and the SAME room code.');
log('warn', 'If getUserMedia() is blocked (file:// restriction), run: npx serve . and use http://localhost:3000');