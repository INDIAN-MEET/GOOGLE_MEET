/**
 * src/call/signaling.ts
 * -------------------------------------------------------------
 * Small helpers around socket.io-client.
 * Used by: CallSession.ts, sfuClient.ts
 */
import { io, type Socket } from 'socket.io-client';
import { getValidAccessToken } from '../lib/apiClient';

// STEP 1 — create (but do NOT connect) a socket.
//          `auth` as a function = fresh token on every reconnect.
export function createSocket(url: string): Socket {
  return io(url, {
    autoConnect: false,
    transports: ['websocket'],
    reconnectionDelayMax: 5000,
    auth: (cb) => {
      void getValidAccessToken().then((token) => cb({ token }));
    },
  });
}

// STEP 2 — await the first successful connection (or fail with a clear error)
export function waitForConnect(socket: Socket, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) { resolve(); return; }

    const finish = (err?: Error) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      if (err) reject(err); else resolve();
    };
    const onConnect = () => finish();
    const onError = (err: Error) => finish(new Error(`Socket connection failed: ${err.message}`));
    const timer = setTimeout(() => finish(new Error('Socket connection timed out')), timeoutMs);

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

// STEP 3 — emit + wait for the server's acknowledgement.
//          Server side can answer with { success: true, data } or { error: 'message' } / { success: false, message }.
export function request<T = unknown>(
  socket: Socket,
  event: string,
  payload?: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`"${event}" timed out`)), timeoutMs);
    socket.emit(event, payload, (res: any) => {
      clearTimeout(timer);
      if (res && typeof res === 'object') {
        if ('success' in res) {
          if (res.success) {
            resolve(res.data as T);
          } else {
            reject(new Error(res.message || `Request "${event}" failed`));
          }
          return;
        }
        if ('error' in res && res.error) {
          reject(new Error(String(res.error)));
          return;
        }
      }
      resolve(res as T);
    });
  });
}
