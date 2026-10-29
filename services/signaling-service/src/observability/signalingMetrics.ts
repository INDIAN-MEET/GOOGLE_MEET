// services/signaling-service/src/observability/signalingMetrics.ts

import type { Server } from 'socket.io';
import client from 'prom-client';
import { register } from './metrics.js';

/** Events we are willing to use as label values. Everything else becomes "other". */
const KNOWN_EVENTS = new Set([
  'join-room',
  'leave-room',
  'offer',
  'answer',
  'ice-candidate',
  'chat-message',
]);

/** Number of Socket.io connections currently open. */
export const connectedSockets = new client.Gauge({
  name: 'signaling_connected_sockets',
  help: 'Number of currently connected Socket.io clients',
  registers: [register],
});

/** Total incoming Socket.io events, by (safe) event name. */
export const socketEventsTotal = new client.Counter({
  name: 'signaling_events_total',
  help: 'Incoming Socket.io events',
  labelNames: ['event'] as const,
  registers: [register],
});

/**
 * Attaches metrics to a Socket.io server. Call it once, after the server is created.
 * Note: this runs for connections that passed your socket auth middleware.
 *
 * @param io - the Socket.io server instance
 * @returns nothing
 * @throws {Error} never.
 */
export function instrumentSocketServer(io: Server): void {
  io.on('connection', (socket) => {
    connectedSockets.inc();
    // onAny sees every event without changing your existing handlers.
    socket.onAny((event: string) => {
      socketEventsTotal.inc({ event: KNOWN_EVENTS.has(event) ? event : 'other' });
    });
    socket.on('disconnect', () => connectedSockets.dec());
  });
}

