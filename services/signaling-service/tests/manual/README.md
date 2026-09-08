
# Manual Socket.io Tests

These scripts are throwaway verification tools — not part of the
service's runtime. They are excluded from Docker builds via
`.dockerignore`.

## Setup (one-time)

```powershell
npm install --save-dev socket.io-client
```

## Running a 2-client join test

1. Get two real access tokens from Auth Service (two different users).
2. Create a room via Room Service using the first user's token, copy the `code`.
3. Open two terminals:

**Terminal 1 (host):**

```powershell
npx tsx tests/manual/join-room.client.ts <hostToken> <roomCode>
```

**Terminal 2 (second user):**

```powershell
npx tsx tests/manual/join-room.client.ts <secondUserToken> <roomCode>
```

Expected: Terminal 1 logs `[peer-joined]` the moment Terminal 2 connects.
Press Ctrl+C in either terminal to test disconnect cleanup (the other
terminal should log `[peer-left]`).
