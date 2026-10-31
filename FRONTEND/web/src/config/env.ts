/**
 * src/config/env.ts
 * -------------------------------------------------------------
 * Reads Vite env variables ONCE and fails fast if one is missing.
 * Used by: apiClient.ts, signaling.ts, CallSession.ts, iceServers.ts
 */

// STEP 1 — helper that reads one variable or throws a clear error
function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    throw new Error(`Missing env var ${name}. Check FRONTEND/web/.env`);
  }
  return value.replace(/\/$/, ''); // remove a trailing slash if present
}

// STEP 2 — export one frozen object (no one can mutate it later)
export const env = Object.freeze({
  apiUrl: required('VITE_API_URL'),             // Gateway :4000
  signalingUrl: required('VITE_SIGNALING_URL'), // Signaling :4004
  sfuUrl: required('VITE_SFU_URL'),             // SFU :4006 (or = signaling)
  turnUrl: required('VITE_TURN_URL'),           // turn:host:3478
});

