/**
 * src/api/users.ts  →  user-service (:4002) via Gateway
 * Gateway strips /users:  /api/users/me → /me
 */
import { api } from '../lib/apiClient';
import type { ApiEnvelope, Profile } from '../types/api';

// STEP 1 — read my profile (auto-created by the Redis "user-created" event)
export async function getProfile(): Promise<Profile> {
  const res = await api.get<ApiEnvelope<Profile>>('/users/me');
  return res.data.data;
}

// STEP 2 — update displayName / avatarUrl / preferences
export async function updateProfile(patch: Partial<Profile>): Promise<Profile> {
  const res = await api.patch<ApiEnvelope<Profile>>('/users/me', patch);
  return res.data.data;
}
