import axios from 'axios';
import { env } from './env.ts';
import { AppError } from '../utils/AppError.ts';

export interface RoomInfo {
  id: string;
  code: string;
  hostUserId: string;
  isActive: boolean;
}

/**
 * getActiveRoom(code, token)
 *
 * STEP 1: Call GET <ROOM_SERVICE_URL>/v1/rooms/<code> with the caller's own token.
 * STEP 2: Room missing (404) or isActive false -> return null (controller answers 404).
 * STEP 3: Any other problem -> 502, because it is not the user's fault.
 *
 * CHECK: the response is read as data.room (from your room-service controller).
 *        If the room is returned directly in data, the fallback below handles it.
 */
export async function getActiveRoom(code: string, token: string): Promise<RoomInfo | null> {
  try {
    const res = await axios.get(`${env.roomServiceUrl}/v1/rooms/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    const room = (res.data?.data?.room ?? res.data?.data) as RoomInfo | undefined;
    if (!room || room.isActive === false) return null;
    return room;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw new AppError('Room service unavailable', 502);
  }
}