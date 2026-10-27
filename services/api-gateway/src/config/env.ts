import 'dotenv/config';

/**
 * Reads a REQUIRED string variable from the environment.
 *
 * @param name - Environment variable name, e.g. "JWT_ACCESS_SECRET".
 * @returns The non-empty, trimmed value.
 * @throws {Error} If the variable is missing or empty, so the gateway refuses to start.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`[env] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/**
 * Reads an OPTIONAL non-negative integer from the environment.
 *
 * @param name     - Environment variable name.
 * @param fallback - Value used when the variable is not set.
 * @returns The parsed integer, or `fallback`.
 * @throws {Error} If the variable is set but is not a non-negative integer.
 */
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`[env] ${name} must be a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

/** Port the gateway listens on. */
export const PORT: string = process.env.PORT || '4000';

/** `development` | `production` | `test`. */
export const NODE_ENV: string = process.env.NODE_ENV || 'development';

/** True in production. Used to hide stack traces. */
export const IS_PRODUCTION: boolean = NODE_ENV === 'production';

/** Secret used to verify access tokens. Must match auth-service. */
export const JWT_ACCESS_SECRET: string = required('JWT_ACCESS_SECRET');

if (IS_PRODUCTION && JWT_ACCESS_SECRET.startsWith('change_this')) {
  console.warn('[env] WARNING: JWT_ACCESS_SECRET is still the placeholder value.');
}

/** Allowed CORS origins. `FRONTEND_URL` may hold several, comma separated. */
export const FRONTEND_ORIGINS: string[] = required('FRONTEND_URL')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** auth-service base URL. */
export const AUTH_SERVICE_URL: string = required('AUTH_SERVICE_URL');
/** user-service base URL. */
export const USER_SERVICE_URL: string = required('USER_SERVICE_URL');
/** room-service base URL. */
export const ROOM_SERVICE_URL: string = required('ROOM_SERVICE_URL');
/** chat-service base URL. */
export const CHAT_SERVICE_URL: string = required('CHAT_SERVICE_URL');
/** recording-service base URL (local default for non-docker dev). */
export const RECORDING_SERVICE_URL: string =
  process.env.RECORDING_SERVICE_URL || 'http://localhost:4007';
/** notification-service base URL (local default for non-docker dev). */
export const NOTIFICATION_SERVICE_URL: string =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4008';

/** Redis connection string (rate limiter + readiness probe). */
export const REDIS_URL: string = required('REDIS_URL');

/**
 * Number of reverse proxies in front of the gateway.
 * 0 = direct connection, 1 = one load balancer. A wrong value lets attackers bypass limits.
 */
export const TRUST_PROXY: number = int('TRUST_PROXY', 0);

/** Maximum JSON body size, e.g. `100kb`. */
export const BODY_LIMIT: string = process.env.BODY_LIMIT || '100kb';

/** All rate-limit numbers in one place. Counts can be overridden by env. */
export const RATE_LIMITS = {
  global: { windowMs: 60_000, limit: int('RATE_LIMIT_GLOBAL_MAX', 300) },
  login: { windowMs: 15 * 60_000, limit: int('RATE_LIMIT_LOGIN_MAX', 10) },
  signup: { windowMs: 15 * 60_000, limit: int('RATE_LIMIT_SIGNUP_MAX', 10) },
  refresh: { windowMs: 15 * 60_000, limit: int('RATE_LIMIT_REFRESH_MAX', 30) },
  standard: { windowMs: 60_000, limit: int('RATE_LIMIT_STANDARD_MAX', 100) },
  download: { windowMs: 60 * 60_000, limit: int('RATE_LIMIT_DOWNLOAD_MAX', 120) },
} as const;