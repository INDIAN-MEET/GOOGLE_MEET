# Google Meet Frontend Web Application

The frontend client for the Google Meet microservices clone, built with **React 19**, **TypeScript**, **Vite**, and **mediasoup-client**.

---

## Features

- **Authentication:** Signup, login, JWT token lifecycle management, and automatic refresh with HTTP-only cookies.
- **Pre-Join Green Room:** Real-time camera and microphone device previews, mute toggles, device error guards, and 1-click meeting join.
- **Mediasoup SFU Media:** Group video calling (3+ peers), responsive video grid, track flipping, and `close-producer` notifications.
- **Real-Time Two-Way Chat:** Socket.IO bidirectional room chat with MongoDB persistence and history backfill.
- **Meeting Invitations:** 1-click meeting URL clipboard copy and BullMQ email dispatcher via Notification Service with local Mailpit integration (`http://localhost:8025`).
- **Meeting Recordings:** Host-privileged start and stop controls supporting both UUID and roomCode identifiers, status polling, and playback/download.
- **Host Controls:** Privileged "Invite guests" and "End meeting for all" with Redis `room-events` pub/sub termination propagation.

---

## Running the Frontend

### In Docker (Production Mode)
The frontend is containerized in `google_meet-frontend` and served via Nginx on port `5173`:
```bash
docker compose up -d frontend
```
Visit: [http://localhost:5173](http://localhost:5173)

### Locally (Development Mode)
```bash
cd FRONTEND/web
npm install
npm run dev
```

---

## Architecture & Code Structure

```
src/
├── api/             # REST API clients (auth, rooms, recordings, notifications, users)
├── auth/            # AuthContext, token storage, and session guards
├── call/            # CallSession, sfuClient (mediasoup), signaling, callStore (Zustand)
├── components/      # UI components (VideoGrid, VideoTile, ControlsBar, ChatPanel, RecordingPanel, InvitePanel, PreJoin)
├── media/           # Local media devices hook (useLocalMedia)
├── pages/           # Route views (HomePage, AuthPage, RoomPage)
└── types/           # TypeScript interfaces and API response shapes
```
