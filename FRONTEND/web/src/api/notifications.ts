/**
 * src/api/notifications.ts  →  notification-service (:4008) via Gateway
 * Host sends email invites; reminders are scheduled by the backend (BullMQ).
 */
import { api } from '../lib/apiClient';

// STEP 1 — invite guests by email
export async function sendInvites(
  roomCode: string,
  guestEmails: string[],
  message?: string,
  hostName?: string
): Promise<void> {
  await api.post('/v1/notifications/invites', {
    roomCode,
    emails: guestEmails,
    ...(message ? { message } : {}),
    ...(hostName ? { hostName } : {}),
  });
}
