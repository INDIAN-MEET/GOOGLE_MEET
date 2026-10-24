import axios from "axios";
import { env } from "./env.ts";
import { AppError } from "../utils/AppError.ts";

/** Subset of the room object this service cares about. */
export interface RoomInfo {
  code: string;
  title: string | null;
  hostId: string;
  scheduledAt: string | null; // ISO string or null for instant rooms
  status?: string;
}

const http = axios.create({
  baseURL: env.roomServiceUrl,
  timeout: 5000,
});

/**
 * Fetch a room from room-service using the caller's access token.
 *
 * @param roomCode Human-readable room code, for example "abc-defg-hij".
 * @param bearerToken Raw JWT (without the "Bearer " prefix).
 * @returns Room details used for host verification and reminder scheduling.
 * @throws AppError 404 if the room does not exist, 502 on other upstream failures.
 */
export async function fetchRoom(roomCode: string, bearerToken: string): Promise<RoomInfo> {
  try {
    const res = await http.get(`/v1/rooms/${encodeURIComponent(roomCode)}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const raw = (res.data?.data?.room ?? res.data?.data) as Record<string, any> | undefined;
    if (!raw) throw new AppError("Unexpected room-service response", 502);

    const room: RoomInfo = {
      code: raw.code,
      title: raw.title ?? null,
      hostId: raw.hostUserId ?? raw.hostId,
      scheduledAt: raw.scheduledAt ?? null,
      status: raw.isActive === false || raw.endedAt ? "ended" : (raw.status ?? "active"),
    };

    return room;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err.response?.status === 404) throw new AppError("Room not found", 404);
    if (err.response?.status === 403) throw new AppError("You do not have access to this room", 403);
    throw new AppError("Room service unavailable", 502);
  }
}