/**
 * src/call/iceServers.ts
 * -------------------------------------------------------------
 * Turns the /auth/turn-credentials answer into WebRTC `iceServers`.
 */
import { env } from '../config/env';
import type { TurnCredentials } from '../types/api';

export function buildIceServers(creds: TurnCredentials | null): RTCIceServer[] {
  // If the server directly returned iceServers array, use it
  if (creds?.iceServers && Array.isArray(creds.iceServers) && creds.iceServers.length > 0) {
    return creds.iceServers as RTCIceServer[];
  }

  // STEP 1 — STUN: free, finds our public address (same host as Coturn)
  const stunUrl = env.turnUrl.replace(/^turns?:/, 'stun:');
  const servers: RTCIceServer[] = [{ urls: stunUrl }];

  // STEP 2 — TURN: relay fallback, needs the short-lived credentials
  if (creds && creds.username) {
    servers.push({
      urls: creds.urls ?? [env.turnUrl, `${env.turnUrl}?transport=tcp`],
      username: creds.username,
      credential: creds.password ?? creds.credential,
    });
  }
  return servers;
}
