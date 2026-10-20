import axios from 'axios';
import { env } from './env.ts';
import { AppError } from '../utils/AppError.ts';

/**
 * sfuClient.ts
 *
 * STEP 1: One axios instance with the SFU base URL, the x-internal-secret header,
 *         and a 5 second timeout.
 * STEP 2: call() unwraps { data } from the SFU response.
 * STEP 3: SFU errors keep their status (404 = nobody in the call, 409 = already recording).
 *         If the SFU cannot be reached at all -> 503.
 *
 * NOTE: roomId for the SFU is the roomCode (signaling uses the same value).
 */
const http = axios.create({
  baseURL: `${env.sfuServiceUrl}/api/v1/sfu`,
  timeout: 5000,
  headers: { 'x-internal-secret': env.internalSecret },
});

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  try {
    const res = await http.request({ method, url, data: body });
    return (res.data?.data ?? res.data) as T;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new AppError(err.response.data?.message ?? 'SFU error', err.response.status);
    }
    throw new AppError('SFU service unreachable', 503);
  }
}

export const startCapture = (roomId: string, recordingId: string) =>
  call<{ started: boolean; segments: number }>('POST', '/recordings/start', { roomId, recordingId });

export const stopCapture = (roomId: string, recordingId: string) =>
  call<{ stopping: boolean }>('POST', '/recordings/stop', { roomId, recordingId });

export const captureStatus = (roomId: string) =>
  call<{ active: boolean; recordingId?: string; segments: number }>(
    'GET',
    `/recordings/${encodeURIComponent(roomId)}/status`,
  );