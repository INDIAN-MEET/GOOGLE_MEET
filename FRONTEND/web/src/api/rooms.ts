/**
 * src/api/rooms.ts  →  room-service (:4003) via Gateway
 * NOTE: /v1 is part of the client URL for this service
 */
import { api } from '../lib/apiClient';
import type { ApiEnvelope, Room, RoomDetails } from '../types/api';

// STEP 1 — create a room (caller becomes host). Optional scheduledAt (ISO string)
export async function createRoom(title: string, scheduledAt?: string): Promise<Room> {
  const res = await api.post<ApiEnvelope<{ room: Room } | Room>>('/v1/rooms', {
    title,
    ...(scheduledAt ? { scheduledAt } : {}),
  });
  const data = res.data.data;
  return 'room' in data ? (data as { room: Room }).room : (data as Room);
}

// STEP 2 — room info + participants (also our "does this room exist?" check)
export async function getRoom(code: string): Promise<RoomDetails> {
  const res = await api.get<ApiEnvelope<RoomDetails>>(`/v1/rooms/${encodeURIComponent(code)}`);
  return res.data.data;
}

// STEP 3 — join / leave / end
export const joinRoom = (code: string) => api.post(`/v1/rooms/${encodeURIComponent(code)}/join`);
export const leaveRoom = (code: string) => api.post(`/v1/rooms/${encodeURIComponent(code)}/leave`);
export const endRoom = (code: string) => api.post(`/v1/rooms/${encodeURIComponent(code)}/end`); // host only

