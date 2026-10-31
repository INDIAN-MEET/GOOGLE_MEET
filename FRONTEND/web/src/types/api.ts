/**
 * src/types/api.ts
 * -------------------------------------------------------------
 * TypeScript shapes of what the backend returns.
 */

// STEP 1 — every success response is wrapped as { data: ... }
export interface ApiEnvelope<T> {
  success?: boolean;
  data: T;
  message?: string;
  requestId?: string;
}

// STEP 2 — auth-service
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}
export interface Me {
  userId: string; // GET /auth/me returns ONLY this
}
export interface TurnCredentials {
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  username?: string;
  password?: string;
  credential?: string;
  ttl?: number;
  expiry?: number;
  urls?: string[];
}

// STEP 3 — user-service
export interface Profile {
  id?: string;
  userId?: string;
  displayName?: string;
  avatarUrl?: string;
  preferences?: Record<string, unknown>;
}

// STEP 4 — room-service
export interface Room {
  id?: string;
  code: string;
  title?: string;
  hostUserId?: string;
  hostId?: string;
  isActive?: boolean;
  status?: string;
  createdAt?: string;
  endedAt?: string | null;
  scheduledAt?: string | null;
}
export interface Participant {
  id?: string;
  userId: string;
  role?: 'host' | 'participant';
  joinedAt?: string;
  leftAt?: string | null;
}
export interface RoomDetails {
  room: Room;
  participants?: Participant[];
}

// STEP 5 — chat-service
export interface ChatMessage {
  id?: string;
  _id?: string;
  roomId?: string;
  senderId: string;
  senderName?: string;
  text: string;
  createdAt?: string;
}

// STEP 6 — recording-service
export type RecordingStatus =
  | 'STARTING' | 'RECORDING' | 'STOPPING' | 'PROCESSING' | 'READY' | 'COMPLETED' | 'FAILED';
export interface Recording {
  id: string;
  roomId?: string;
  status: RecordingStatus;
  durationSec?: number;
  sizeBytes?: number;
  createdAt?: string;
}

// STEP 7 — notification-service
export interface InviteResponse {
  sent?: number;
  queued?: number;
  invited?: string[];
}

