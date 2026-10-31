/**
 * src/api/auth.ts  →  auth-service (:4001) via Gateway
 * Gateway rewrites /api/auth/* → /api/v1/auth/*
 */
import { api } from '../lib/apiClient';
import { tokenStore } from '../lib/tokenStore';
import type { ApiEnvelope, AuthTokens, Me, TurnCredentials } from '../types/api';

// STEP 1 — signup (public). Account only; we log in right after.
export async function signup(email: string, password: string): Promise<void> {
  await api.post('/auth/signup', { email, password });
}

// STEP 2 — login (public). Returns tokens; caller stores them.
export async function login(email: string, password: string): Promise<AuthTokens> {
  const res = await api.post<ApiEnvelope<AuthTokens>>('/auth/login', { email, password });
  return res.data.data;
}

// STEP 3 — logout (protected). Best effort: we clear local tokens anyway.
export async function logout(): Promise<void> {
  await api.post('/auth/logout', { refreshToken: tokenStore.getRefresh() }).catch(() => {});
}

// STEP 4 — who am I? (returns ONLY { userId })
export async function getMe(): Promise<Me> {
  const res = await api.get<ApiEnvelope<Me>>('/auth/me');
  return res.data.data;
}

// STEP 5 — short-lived TURN credentials (HMAC) for WebRTC NAT traversal
export async function getTurnCredentials(): Promise<TurnCredentials> {
  const res = await api.get<ApiEnvelope<TurnCredentials>>('/auth/turn-credentials');
  return res.data.data;
}

