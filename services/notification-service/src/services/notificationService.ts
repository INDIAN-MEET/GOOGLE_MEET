import { prisma } from "../config/prisma.ts";
import { env } from "../config/env.ts";
import { emailQueue } from "../queue/queues.ts";
import { logger } from "../utils/logger.ts";
import type { RoomInfo } from "../config/roomServiceClient.ts";

/** Input for creating invites. */
export interface InviteInput {
  room: RoomInfo;
  emails: string[];
  hostId: string;
  hostName?: string;
  message?: string;
}

/** What the API returns to the caller. */
export interface InviteResult {
  invited: string[];
  remindersScheduled: number;
}

/**
 * Remove duplicate addresses (case-insensitive) while keeping order.
 *
 * @param emails Raw list from the request.
 * @returns Unique, lower-cased addresses.
 */
function dedupe(emails: string[]): string[] {
  return [...new Set(emails.map((e) => e.toLowerCase()))];
}

/**
 * Create one Notification row and enqueue its BullMQ job.
 * Safe to call twice with the same jobId: the unique constraint on `jobId`
 * means the second call finds the existing row and does nothing.
 *
 * @returns true if a new notification was created, false if it already existed.
 */
async function createAndEnqueue(params: {
  type: "INVITE" | "REMINDER";
  jobId: string;
  email: string;
  room: RoomInfo;
  hostId: string;
  hostName?: string;
  message?: string;
  meetingAt: Date | null;
  sendAt: Date;
}): Promise<boolean> {
  const existing = await prisma.notification.findUnique({ where: { jobId: params.jobId } });
  if (existing) return false;

  const row = await prisma.notification.create({
    data: {
      type: params.type,
      recipientEmail: params.email,
      roomCode: params.room.code,
      roomTitle: params.room.title,
      hostName: params.hostName,
      message: params.message,
      meetingAt: params.meetingAt,
      sendAt: params.sendAt,
      jobId: params.jobId,
      createdBy: params.hostId,
    },
  });

  const delay = Math.max(0, params.sendAt.getTime() - Date.now());
  await emailQueue.add("send-email", { notificationId: row.id }, { jobId: params.jobId, delay });
  return true;
}

/**
 * Create invitation emails (sent immediately) and, for scheduled rooms,
 * reminder emails (delayed).
 *
 * @param input Room, recipients and host details.
 * @returns Which addresses were invited and how many reminders were scheduled.
 */
export async function createInvites(input: InviteInput): Promise<InviteResult> {
  const { room, hostId, hostName, message } = input;
  const emails = dedupe(input.emails);
  const meetingAt = room.scheduledAt ? new Date(room.scheduledAt) : null;
  const now = Date.now();

  let remindersScheduled = 0;

  for (const email of emails) {
    // 1) Invitation: always sent right away.
    await createAndEnqueue({
      type: "INVITE",
      jobId: `invite_${room.code}_${email}`,
      email,
      room,
      hostId,
      hostName,
      message,
      meetingAt,
      sendAt: new Date(now),
    });

    // 2) Reminders: only for scheduled rooms, and only if still in the future.
    if (meetingAt) {
      for (const minutes of env.reminderOffsetsMin) {
        const sendAt = new Date(meetingAt.getTime() - minutes * 60_000);
        if (sendAt.getTime() <= now) continue; // too late for this reminder

        const created = await createAndEnqueue({
          type: "REMINDER",
          jobId: `rem_${room.code}_${minutes}_${email}`,
          email,
          room,
          hostId,
          hostName,
          meetingAt,
          sendAt,
        });
        if (created) remindersScheduled++;
      }
    }
  }

  logger.info({ room: room.code, invited: emails.length, remindersScheduled }, "Invites created");
  return { invited: emails, remindersScheduled };
}

/**
 * Cancel every pending REMINDER for a room (used when the room ends or is
 * cancelled). Two layers of safety:
 *  - Remove the delayed job from Redis so it never fires.
 *  - Mark the DB row CANCELLED so the worker skips it even if removal failed.
 *
 * @param roomCode Room whose reminders should stop.
 * @returns Number of reminders cancelled.
 */
export async function cancelRemindersForRoom(roomCode: string): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { roomCode, type: "REMINDER", status: "PENDING" },
    select: { id: true, jobId: true },
  });

  for (const n of pending) {
    // Removing a job that already ran or does not exist is harmless.
    await emailQueue.remove(n.jobId).catch(() => undefined);
  }

  const { count } = await prisma.notification.updateMany({
    where: { id: { in: pending.map((p) => p.id) }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  logger.info({ roomCode, cancelled: count }, "Reminders cancelled");
  return count;
}