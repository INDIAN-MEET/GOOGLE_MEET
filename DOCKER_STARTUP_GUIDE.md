# 🐳 Docker Startup & Running Guide

A step-by-step, beginner-friendly guide to running the entire Google Meet microservices stack locally or on any server using Docker and Docker Compose.

---

## 📋 Table of Contents
1. [System Prerequisites](#1-system-prerequisites)
2. [Port Directory & Service Map](#2-port-directory--service-map)
3. [Method 1: Quickstart from Source (Recommended)](#3-method-1-quickstart-from-source-recommended)
4. [Method 2: Lightweight Release Startup (GHCR Images)](#4-method-2-lightweight-release-startup-ghcr-images)
5. [Verifying the Stack](#5-verifying-the-stack)
6. [Interactive Feature Walkthrough](#6-interactive-feature-walkthrough)
7. [Running Automated E2E Tests](#7-running-automated-e2e-tests)
8. [Troubleshooting & FAQ](#8-troubleshooting--faq)
9. [Stopping & Cleaning Up](#9-stopping--cleaning-up)

---

## 1. System Prerequisites

Before starting, ensure your system has:
- **Operating System:** Windows 10/11 (with WSL2), macOS (Intel or Apple Silicon), or Linux (Ubuntu, Debian, CentOS).
- **Docker Desktop or Docker Engine:** Version `24.0.0` or newer.
- **Docker Compose:** Version `v2.20.0` or newer (included with Docker Desktop).
- **Hardware:** Minimum 4 CPU cores and 8GB RAM recommended (stack runs 18 containers).
- **Node.js (Optional):** Node.js `20+` or `22+` if you want to run the automated E2E test scripts directly on your host machine.

---

## 2. Port Directory & Service Map

The stack exposes the following ports on `localhost`:

| Service / Container | Host Port | Purpose | Direct Browser URL |
| :--- | :---: | :--- | :--- |
| **Frontend Web App** | `5173` | React 19 Google Meet Client UI | [http://localhost:5173](http://localhost:5173) |
| **API Gateway** | `4000` | Single HTTP entrypoint & rate limiting | [http://localhost:4000/health](http://localhost:4000/health) |
| **Auth Service** | `4001` | Authentication & TURN HMAC tokens | Internal / Proxied via Gateway |
| **User Service** | `4002` | User profiles | Internal / Proxied via Gateway |
| **Room Service** | `4003` | Room codes & participant state | Internal / Proxied via Gateway |
| **Signaling Service** | `4004` | WebSocket WebRTC signaling | Direct client connection (`ws://`) |
| **Chat Service** | `4005` | MongoDB chat history | Internal / Proxied via Gateway |
| **SFU Service** | `4006` | Mediasoup video/audio router | Internal / Proxied via Signaling |
| **Recording Service** | `4007` | FFmpeg video capture & transcoding | Internal / Proxied via Gateway |
| **Notification Service**| `4008` | BullMQ email queue dispatcher | Internal / Proxied via Gateway |
| **Mailpit (Web Inbox)**| `8025` | Local fake email inbox (catches invites) | [http://localhost:8025](http://localhost:8025) |
| **Mailpit (SMTP)** | `1025` | Internal SMTP port for notifications | Internal |
| **Grafana Dashboards** | `3001` | System & WebRTC monitoring dashboards | [http://localhost:3001](http://localhost:3001) |
| **Prometheus UI** | `9090` | Raw metrics collection & alerts | [http://localhost:9090](http://localhost:9090) |
| **Jaeger Tracing UI** | `16686` | Distributed request trace timeline | [http://localhost:16686](http://localhost:16686) |
| **Coturn STUN/TURN** | `3478` | WebRTC NAT traversal (UDP/TCP) | Used by browser WebRTC stack |
| **SFU WebRTC UDP** | `20000-20050`| Mediasoup dynamic media stream ports | RTP media transmission |
| **PostgreSQL** | `5432` | Relational database (Auth, Room, Rec) | Internal |
| **MongoDB** | `27017` | Document database for Chat | Internal |
| **Redis** | `6379` | In-memory presence, pub/sub, rate limit| Internal |

---

## 3. Method 1: Quickstart from Source (Recommended)

This method builds container images locally from the repository source code.

### Step 1: Clone the Repository
```bash
git clone https://github.com/INDIAN-MEET/GOOGLE_MEET.git
cd GOOGLE_MEET
```

### Step 2: Initialize Environment Variables
Copy the pre-configured `.env.example` file to `.env`:
```bash
# On Linux/macOS
cp .env.example .env

# On Windows (PowerShell)
Copy-Item .env.example .env
```
*(The default values in `.env.example` work out-of-the-box for local testing.)*

### Step 3: Start the Complete 18-Container Stack
Run Docker Compose in detached mode:
```bash
docker compose up -d --build
```
> ⏱️ *Note: The initial build takes 2 to 4 minutes because Mediasoup compiles its native C++ media worker. Subsequent boots start in under 5 seconds.*

---

## 4. Method 2: Lightweight Release Startup (GHCR Images)

If you do not want to build from source, you can run the pre-built, published production images directly from the GitHub Container Registry:

```bash
docker compose -f docker-compose.release.yml up -d
```

---

## 5. Verifying the Stack

### Check Container Status
Verify that all 18 containers are running and healthy:
```bash
docker compose ps
```
You should see all containers listed as `Up` or `Up (healthy)`.

### Test the API Gateway Health Probes
```bash
curl http://localhost:4000/health
# Expected Output: {"status":"ok","timestamp":"..."}

curl http://localhost:4000/ready
# Expected Output: {"status":"ready","services":{"auth":true,"user":true,"room":true,...}}
```

---

## 6. Interactive Feature Walkthrough

Now that your stack is running, test the complete meeting experience:

### Step 1: Open the Frontend App
Open your browser and navigate to:
👉 **`http://localhost:5173`**

### Step 2: Sign Up & Log In
1. Click **Sign up**.
2. Enter an email (e.g. `alice@example.com`) and password (minimum 8 characters).
3. Click **Create account**. You are logged in automatically!

### Step 3: Create a Meeting Room
1. On the homepage, enter a meeting title (e.g. `Architecture Review`) or leave it blank.
2. Click **New meeting**.
3. You will be taken to the **Green Room / Pre-Join Lobby** (`/room/xxx-xxxx-xxx`).

### Step 4: Pre-Join Hardware Preview
1. Allow browser camera and microphone permissions when prompted.
2. Test the **🎤 Mic on/off** and **📷 Camera on/off** buttons.
3. Click **Join now** to enter the call.

### Step 5: Test Multi-Party Video & Audio (Two Participants)
1. In the meeting header or side drawer, click **📋 Copy link** (or copy the room code).
2. Open a **new Incognito / Private window** (or a second browser like Firefox/Edge).
3. Navigate to `http://localhost:5173`.
4. Sign up as a second user (e.g. `bob@example.com`).
5. Paste the meeting link or enter the code and click **Join**.
6. Both peers will see each other in the dynamic video tile grid!

### Step 6: Test Real-Time Chat
1. Click the **💬 Chat** icon in the bottom control bar.
2. Send messages back and forth between Alice and Bob.
3. Chat history is persisted in MongoDB and loaded automatically.

### Step 7: Test Meeting Invites via Local Mailpit
1. Click the **👥 Invite** button in the control bar.
2. Enter a colleague's email address (e.g. `colleague@company.com`) and send.
3. Open the **Mailpit Web Inbox** at 👉 **`http://localhost:8025`**.
4. You will see the incoming invitation email formatted with the meeting link!

### Step 8: Test Cloud Recording & Transcoding
1. In the host window, click the **🔴 Record** icon.
2. The UI will show a **REC** indicator.
3. Mediasoup SFU captures the RTP stream segments.
4. Click **Stop recording**.
5. BullMQ and FFmpeg will transcode the raw segments into a playable MP4 file.
6. The recording drawer will display the completed file with a **Download MP4** button.

### Step 9: Host Controls & Room Termination
1. Click **End for all**.
2. The Room Service broadcasts the termination event across Redis, and all participants are gracefully disconnected.

### Step 10: Inspect Observability & Telemetry
- **Grafana Dashboards:** Open `http://localhost:3001` (Username: `admin`, Password: `admin12345678`). View real-time active socket counts, SFU router activity, and HTTP response latencies.
- **Jaeger Traces:** Open `http://localhost:16686` and select `api-gateway` or `signaling-service` to inspect distributed trace spans across services.

---

## 7. Running Automated E2E Tests

The repository includes comprehensive automated test suites to verify system functionality:

```powershell
# 1. Probe all 10 microservices via REST (15 checks)
node scripts/e2e-all-services.mjs

# 2. Test API Gateway rate-limiting & error traps
node scripts/e2e-gateway.mjs

# 3. Test Notification Service & Mailpit queues
node scripts/e2e-notification.mjs

# 4. Test Recording Service start/stop lifecycle
node scripts/e2e-recording.mjs

# 5. Assert Prometheus metrics & Jaeger tracing
node scripts/e2e-observability.mjs

# 6. Run headless browser WebRTC multi-party meeting test
node scripts/e2e-full-meet-call.mjs
```

---

## 8. Troubleshooting & FAQ

### Q: Port 5432 or 6379 is already in use!
**Cause:** You have a local PostgreSQL or Redis service running on your machine.  
**Fix:** Stop your local system services or change the external host port mapping in `docker-compose.yml` (e.g. `"5433:5432"`).

### Q: Camera/Microphone is not appearing in the browser.
**Cause:** Modern browsers only allow `getUserMedia` on `localhost` or `https://`.  
**Fix:** Access the app via `http://localhost:5173` (do not use your local machine IP like `http://192.168.x.x:5173` without HTTPS). Ensure camera permissions are allowed in browser site settings.

### Q: Where did the invitation email go? I didn't receive it in Gmail.
**Answer:** In local development, all outbound emails are captured safely by **Mailpit** to prevent spamming real inboxes. View all outgoing mail at **`http://localhost:8025`**.

### Q: How do I view logs for a specific service?
```bash
# Follow logs in real-time for any service:
docker compose logs -f api-gateway
docker compose logs -f signaling-service
docker compose logs -f sfu-service
```

---

## 9. Stopping & Cleaning Up

### Stop All Containers (Preserves Database Data)
```bash
docker compose down
```

### Stop All Containers & Wipe Database Volumes (Clean Slate Reset)
```bash
docker compose down -v
```
*(Use this if you want to start fresh with empty databases.)*

