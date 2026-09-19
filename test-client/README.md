# WebRTC Test Client — Phase 6

> **Diagnostic tool. Not a deployable. Not a microservice.**
> Lives outside `/services`. Has no `package.json`, no `Dockerfile`, no docker-compose entry.

---

## Purpose

Proves that the Signaling Service built in Phase 5 can carry a **real RTCPeerConnection handshake** (real SDP offer/answer + real ICE candidates) all the way to live audio/video between two browser tabs.

Phase 5 tests proved **event delivery** (offer/answer/ice-candidate relay works). This file proves **WebRTC correctness** (a real handshake built on top of that relay actually establishes a media stream).

---

## How to Run

### Step 1 — Prerequisites

Make sure all services are running:

```bash
# From the project root
docker-compose up -d
```

Services needed:

| Service           | Port           | Why                      |
| ----------------- | -------------- | ------------------------ |
| Auth Service      | 4001           | Get access tokens        |
| Room Service      | 4003           | Create/validate rooms    |
| Signaling Service | **4004** | WebSocket signaling      |
| Redis             | 6379           | Room membership tracking |

### Step 2 — Serve the test client

> `file://` URLs block `getUserMedia()` in most browsers (HTTPS/localhost requirement).
> Always serve this via a local HTTP server.

```bash
cd test-client
npx serve .
```

Open **http://localhost:3000** (or whatever port `serve` prints).

### Step 3 — Get credentials

Use Postman or curl to:

1. **Sign up / log in** two different users → get `accessToken` for each
2. **Create a room** with one user → get `roomCode`

```bash
# Example: create a room
POST http://localhost:4000/v1/rooms
Authorization: Bearer <User A's token>
Content-Type: application/json
{"name": "test-room"}
```

### Step 4 — Two tabs

| Tab   | Token                   | Room Code        |
| ----- | ----------------------- | ---------------- |
| Tab 1 | User A's`accessToken` | Same`roomCode` |
| Tab 2 | User B's`accessToken` | Same`roomCode` |

1. Open Tab 1 → paste token + room code → **Join Call** → grant camera/mic
2. Open Tab 2 → paste token + room code → **Join Call** → grant camera/mic

Within a few seconds, both video tiles should show the other tab's camera feed.

---

## Expected Console Output (Tab 1 as caller)

```
[INFO] getUserMedia() granted — 2 tracks (video + audio)
[INFO] Connecting to Signaling Service at ws://localhost:4004 …
[SUCCESS] Socket connected — ID: abc123…
[INFO] Emitting join-room for roomCode: XYZABC
[INFO] 'joined' received — existingMembers: [none]
[INFO] First to join — waiting for a peer…
-- Tab 2 joins --
[INFO] 'peer-joined' — socketId: def456, userId: user-uuid
[INFO] We received peer-joined ⟹ we are the CALLER. Initiating offer…
[INFO] Creating RTCPeerConnection — target: def456
[INFO] Added local track: kind=video, id=…
[INFO] Added local track: kind=audio, id=…
[INFO] Offer created — SDP length: 1842 chars
[INFO] setLocalDescription(offer) done
[SUCCESS] Offer emitted to Signaling Service → targeting def456
[INFO] 'answer' received from def456
[INFO] setRemoteDescription(answer) done — SDP negotiation complete. Awaiting ICE…
[INFO] ICE candidate generated — type: host, protocol: udp
[INFO] ICE connection state → checking
[INFO] ICE connection state → connected
[SUCCESS] ontrack fired — kind: video
[SUCCESS] ✅ Remote video stream attached to <video> element
```

---

## File Structure

```
test-client/
├── index.html   # HTML skeleton + inline styles + video tiles + log panel
├── app.js       # Full WebRTC + Socket.io client logic (vanilla JS, no build)
└── README.md    # This file
```

---

## Known Failure Modes

| Symptom                                   | Likely Cause                           | Fix                                                    |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| No camera prompt                          | `file://` blocks `getUserMedia()`  | Serve via`npx serve .`                               |
| `connect_error` in console              | Invalid token or Signaling not running | Check token, check`docker ps`                        |
| `peer-joined` never fires               | Wrong room code in one tab             | Verify both tabs use identical`roomCode`             |
| `setRemoteDescription` throws           | SDP mangled in relay                   | Check relay.ts isn't double-serialising payload        |
| ICE flows but video never appears         | `ontrack` didn't fire                | Confirm`addTrack()` happens before `createOffer()` |
| Works on localhost, fails across networks | NAT traversal needed                   | Expected — this is what Phase 7 (TURN) solves         |

---

## What This Proves / What It Doesn't

| ✅ Proved by this phase                           | ❌ Not tested here            |
| ------------------------------------------------- | ----------------------------- |
| Real SDP offer/answer survives relay round-trip   | TURN/STUN for restrictive NAT |
| ICE negotiation completes on localhost/LAN        | 3+ simultaneous peers (SFU)   |
| `ontrack` fires and media renders               | Reconnection handling         |
| Phase 5 Signaling is genuinely end-to-end correct | React frontend                |

---

## After This Phase

If **Test 8 (remote video renders)** passes → move to **Phase 7: TURN/STUN hardening**.
Keep this file around as a fast sanity-check after any future Signaling Service changes.
