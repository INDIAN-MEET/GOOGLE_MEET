/**
 * src/lib/apiClient.ts
 * -------------------------------------------------------------
 * axios instance for ALL REST calls through the API Gateway.
 *  - adds the Bearer token
 *  - refreshes on 401 (single-flight) and retries once
 *  - converts every failure into a friendly ApiError
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import { tokenStore } from './tokenStore';

// STEP 1 — our own error type
export class ApiError extends Error {
  status: number;
  requestId?: string;
  retryAfter?: number; // seconds, present on 429
  constructor(message: string, status: number, requestId?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

// STEP 2 — the axios instance. baseURL already contains /api
export const api = axios.create({
  baseURL: `${env.apiUrl}/api`,
  timeout: 15_000,
  withCredentials: true,
});

// STEP 3 — callback AuthContext registers, called when refresh fails
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

// STEP 4 — attach the access token to every request
api.interceptors.request.use((config) => {
  const token = tokenStore.getAccess();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// STEP 5 — single-flight refresh
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStore.getRefresh();
  // plain axios (NOT `api`) withCredentials: true so cookies are sent/received
  const res = await axios.post(
    `${env.apiUrl}/api/auth/refresh`,
    refreshToken ? { refreshToken } : {},
    { withCredentials: true }
  );
  const body = (res.data?.data ?? res.data) as { accessToken: string; refreshToken?: string };
  if (!body.accessToken) {
    throw new Error('No access token returned from refresh');
  }
  tokenStore.setAccess(body.accessToken);
  if (body.refreshToken) tokenStore.setRefresh(body.refreshToken);
  return body.accessToken;
}

/** Returns a token valid for at least 30 s (used before opening sockets). */
export async function getValidAccessToken(): Promise<string | null> {
  if (tokenStore.getAccess() && tokenStore.msUntilExpiry() > 30_000) {
    return tokenStore.getAccess();
  }
  if (!tokenStore.getRefresh() && !tokenStore.getAccess()) return null;
  refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
  try { return await refreshing; } catch { return tokenStore.getAccess(); }
}

// STEP 6 — response interceptor: refresh on 401, otherwise map the error
const NO_REFRESH_PATHS = ['/auth/login', '/auth/signup', '/auth/refresh'];
type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as RetryConfig | undefined;
    const isAuthCall = NO_REFRESH_PATHS.some((p) => original?.url?.includes(p));

    if (err.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
        const newToken = await refreshing;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original); // replay the request
      } catch {
        tokenStore.clear();
        onSessionExpired?.();
      }
    }
    throw toApiError(err);
  },
);

// STEP 7 — error mapping (uses your Phase 12 headers)
function toApiError(err: AxiosError): ApiError {
  const status = err.response?.status ?? 0;
  const body = err.response?.data as
    | { message?: string; error?: string | { message?: string } }
    | undefined;
  const headers = err.response?.headers as Record<string, string> | undefined;

  let message =
    (typeof body?.error === 'object' ? body.error?.message : body?.error) ??
    body?.message ??
    err.message;

  if (status === 0) message = 'Cannot reach the server. Is the Gateway running (and CORS allowed)?';
  if (status === 429) message = 'Too many requests. Please wait a moment.';
  if (status === 502 || status === 504) message = 'Service temporarily unavailable. Try again shortly.';

  const retryAfter = headers?.['retry-after'] ? Number(headers['retry-after']) : undefined;
  return new ApiError(message, status, headers?.['x-request-id'], retryAfter);
}
