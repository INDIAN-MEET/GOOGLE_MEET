# What we built in Steps 10.6 to 10.11, in simple words

## The story in one line

Before: the host could press Record and Stop, but afterwards there was only a raw capture file nobody could use.
Now: after Stop, the system converts the capture to a normal MP4, lets the host list, play, download and delete it, tells the room about it, and cleans up after itself when something goes wrong.

**Important:** I wrote all this code, but I have **not run it**. It is a complete plan with code, and your tests will prove whether it works.

## The big picture

```mermaid
flowchart LR
    Host["Host browser"] --> GW["API Gateway<br/>(10.8)"]
    GW --> REC["Recording service<br/>API + Worker"]
    REC -->|"start / stop"| SFU["SFU<br/>captures raw .mkv"]
    SFU -->|"webhook: capture ended"| REC
    SFU -->|"writes raw files"| VOL[("Shared volume<br/>/recordings")]
    REC -->|"reads raw, writes MP4"| VOL
    REC --> DB[("Postgres<br/>recording_db")]
    REC <--> RED[("Redis<br/>queue, lock, events")]
    RED -->|"recording-events"| SIG["Signaling<br/>(10.9)"]
    SIG -->|"REC started / ready / failed"| Room["Everyone in the room"]
```

Think of it like a restaurant:

- **SFU** is the camera crew that films.
- **Recording service** is the manager and the editing room.
- **Redis queue** is the order ticket rail.
- **Shared volume** is the shelf where both teams put and take the tapes.
- **Signaling** is the loudspeaker that tells everyone what is happening.

## What each step does

### Step 10.6: Worker that converts MKV to MP4

**Problem:** your recording stayed stuck in `PROCESSING` forever. The raw `.mkv` is not meant for downloading.

**What we added:**

- A **worker** that takes the job from the queue (BullMQ).
- It uses **FFmpeg** to convert each raw file to MP4, which browsers can play.
- It makes a **thumbnail** picture.
- It marks the recording `READY` and announces it.

**Key points:**

- Tiny or broken raw files (like your 521-byte test) fail immediately, with no pointless retries.
- Temporary problems get 3 tries with waiting time in between.
- It writes to a temporary file first, then renames it, so nobody ever sees a half-made MP4.
- It never deletes the raw files at this stage.
- Recording service must run **in Docker**, so it can see the same volume as the SFU.

```mermaid
flowchart TD
    A["Job: finalize recording"] --> B{"Raw file OK?<br/>exists and not tiny"}
    B -- no --> F1["Segment FAILED<br/>no retry"]
    B -- yes --> C["FFmpeg: MKV to temp MP4"]
    C --> D["Rename to final MP4"]
    D --> E["Segment READY"]
    E --> G{"At least one<br/>segment READY?"}
    F1 --> G
    G -- yes --> H["Thumbnail, Recording READY,<br/>send recording-ready"]
    G -- no --> I["Recording FAILED,<br/>send recording-failed"]
```

### Step 10.7: Storage and the recording APIs

**Problem:** the MP4 files exist, but the host has no way to reach them.

**What we added:** a storage layer plus four endpoints:

- `GET /recordings` to list
- `GET /recordings/:id` for details
- `GET /recordings/:id/download` to download
- `DELETE /recordings/:id` to delete

**Key points:**

- Only the person who started the recording can see, download, or delete it (others get 403).
- The server never trusts a path from the user. It looks up its own database record and uses the stored key.
- Files are streamed, not loaded into memory, and seeking in the video works.
- Not ready yet gives 409. File missing gives 404.
- The storage layer is separate, so S3 can be plugged in later.

### Step 10.8: Gateway proxy

**Problem:** the browser should only talk to the gateway, not to port 4007.

**What we added:** one rule that sends `/api/v1/recordings/*` to the recording service.

**Key points:**

- The gateway checks the login first.
- `/internal/*` is not forwarded, so only the SFU can call the webhook.
- This step is **not based on your gateway code**, because I have not seen it. I need your gateway file to make it exact.

### Step 10.9: Signaling events

**Problem:** participants never find out that recording started or finished.

**What we added:** signaling listens to Redis and forwards four events to the room: `recording-started`, `recording-stopped`, `recording-ready`, `recording-failed`. Late joiners also get `recording.active` when they join.

```mermaid
sequenceDiagram
    participant R as Recording service
    participant X as Redis
    participant S as Signaling
    participant P as People in the room
    R->>X: publish "recording-ready"
    X->>S: message
    S->>S: check format, ignore bad or duplicate
    S->>P: emit to that room only
```

**Key points:** bad or duplicate messages are ignored, and clients never receive file paths or internal errors. This step is also **not based on your signaling code**.

### Step 10.10: Docker Compose and the full test

**Problem:** every part worked alone, but the product only works when all of them work together.

**What we added:**

- recording-service in Docker with the same `recordings_data` volume as the SFU
- A test script (`e2e-recording.mjs`) that does start, 20 seconds of recording, stop, wait for `READY`, download, and a range request
- Two failure tests: a missing raw file, and a broken FFmpeg that triggers retries and then final failure

**Key point:** use Chrome's fake camera and microphone for the test, because it produces real video and audio (a fake peer does not).

### Step 10.11: Hardening (making it safe when things go wrong)

| Feature              | Problem it solves                                  | What it does                                                                                                                   |
| :------------------- | :------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Auto-stop**  | Someone forgets to stop and the disk fills         | Stops the recording after `MAX_RECORDING_MINUTES` (default 240)                                                              |
| **Recovery**   | A crash or a lost webhook leaves a recording stuck | Every 5 minutes it repairs stuck recordings. It uses `manifest.json` if available, otherwise marks them `FAILED`           |
| **Cleanup**    | Raw files waste disk space                         | Deletes raw files only after the MP4 is confirmed and the retention time has passed                                            |
| **Disk guard** | A full disk corrupts files                         | Refuses to start new recordings when space is low (503). It does not stop running ones, unless you enable the emergency option |
| **Health**     | You cannot see problems early                      | A new `/ready` page shows database, Redis and disk level                                                                     |

**Key points:**

- Raw files of failed segments are never auto-deleted, since they may be the only copy.
- The host closing their browser does **not** stop the recording, because the server records it.
- BullMQ retries a job that failed while the service was alive. Recovery fixes what BullMQ cannot see, such as the service dying before it queued the job.

## The full life of one recording

```mermaid
stateDiagram-v2
    [*] --> STARTING: host presses Record
    STARTING --> RECORDING: SFU capture started
    STARTING --> FAILED: SFU error or crash
    RECORDING --> STOPPING: host stops, or auto-stop
    STOPPING --> PROCESSING: SFU webhook arrives
    PROCESSING --> READY: MP4 created
    PROCESSING --> FAILED: no usable segment
    READY --> [*]: host downloads or deletes
    FAILED --> [*]
```

Every state has a way out, and recovery handles the ones that could get stuck. This is how we meet "never stuck in a middle status".

## What is real and what is not

| Part                   | Status                                                                           |
| :--------------------- | :------------------------------------------------------------------------------- |
| Steps 10.1 to 10.5     | Built and tested by you                                                          |
| 10.6, 10.7, 10.11 code | Written for your recording-service. Not run yet                                  |
| 10.8, 10.9, 10.10 code | Written from the guide. I have not seen your gateway, signaling or compose files |
| All "Expected" results | Predictions, not test results                                                    |

## What you should do next

1. Apply 10.6 first: copy the files, run `npx tsc --noEmit`, and build the Docker image.
2. Run the 20-second real media test and check that the recording reaches `READY`.
3. Send me any error you get. Also send me your gateway routes file, the signaling files, `docker-compose.yml`, and the recording-service `package.json`, so I can make steps 10.8 to 10.10 exact.
4. Then continue with 10.7, and so on, one step at a time.

I'd go one step at a time rather than pasting everything at once, because a failure in step 10.6 will break the later steps, and it is easier to fix while it is small.
