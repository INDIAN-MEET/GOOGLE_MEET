/**
 * src/api/recordings.ts  →  recording-service (:4007) via Gateway
 * start/stop are HOST-ONLY (403 for others, 409 if room is empty).
 */
import { api } from '../lib/apiClient';
import type { ApiEnvelope, Recording } from '../types/api';

// STEP 1 — start / stop
export async function startRecording(roomCode: string): Promise<Recording> {
  const res = await api.post<ApiEnvelope<Recording>>('/v1/recordings/start', { roomId: roomCode });
  return res.data.data;
}
export async function stopRecording(recordingId: string): Promise<void> {
  await api.post(`/v1/recordings/${encodeURIComponent(recordingId)}/stop`);
}

// STEP 2 — list recordings of a room, and read one (used for status polling)
export async function listRecordings(roomCode: string): Promise<Recording[]> {
  const res = await api.get<ApiEnvelope<Recording[] | { recordings: Recording[] }>>(
    `/v1/recordings/room/${encodeURIComponent(roomCode)}`,
  );
  const d = res.data.data;
  return Array.isArray(d) ? d : d.recordings ?? [];
}
export async function getRecording(id: string): Promise<Recording> {
  const res = await api.get<ApiEnvelope<Recording>>(`/v1/recordings/${encodeURIComponent(id)}`);
  return res.data.data;
}

// STEP 3 — download as Blob
export async function downloadRecording(id: string): Promise<Blob> {
  const res = await api.get<Blob>(`/v1/recordings/${encodeURIComponent(id)}/download`, {
    responseType: 'blob',
    timeout: 10 * 60_000,
  });
  return res.data;
}
