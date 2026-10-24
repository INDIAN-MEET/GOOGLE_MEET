import type { Request, Response } from "express";
import { fetchRoom } from "../config/roomServiceClient.ts";
import { createInvites } from "../services/notificationService.ts";
import { AppError } from "../utils/AppError.ts";

/**
 * POST /v1/notifications/invites
 *
 * Flow:
 *  1. Ask room-service for the room (proves it exists and the caller can see it).
 *  2. Make sure the caller is the HOST. Only hosts may invite.
 *  3. Refuse if the room already ended.
 *  4. Create the invites (and reminders for scheduled rooms).
 *
 * Responds 202 Accepted: emails are queued, not yet delivered.
 */
export async function createInviteController(req: Request, res: Response): Promise<void> {
  const { roomCode, emails, message, hostName } = req.body as {
    roomCode: string;
    emails: string[];
    message?: string;
    hostName?: string;
  };

  const room = await fetchRoom(roomCode, req.accessToken!);

  if (room.hostId !== req.userId) {
    throw new AppError("Only the host can send invitations", 403);
  }
  if (room.status && room.status.toLowerCase() === "ended") {
    throw new AppError("This room has already ended", 409);
  }

  const result = await createInvites({
    room,
    emails,
    hostId: req.userId!,
    hostName: hostName || undefined,
    message: message || undefined,
  });

  res.status(202).json({ success: true, data: result });
}