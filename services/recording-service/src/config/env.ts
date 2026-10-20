import 'dotenv/config';

/**
 * Reads a mandatory environment variable.
 *
 * @param name - Name of the variable.
 * @returns The non-empty value.
 * @throws Error when the variable is missing, so the service refuses to boot.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

/**
 * Reads an optional integer variable with a default and a lower bound.
 *
 * @param name - Name of the variable.
 * @param fallback - Value used when the variable is not set.
 * @param min - Smallest accepted value.
 * @returns The parsed integer or the fallback.
 * @throws Error when the value is not an integer or is below `min`.
 */
function intFromEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return value;
}

/**
 * STEP 1: INTERNAL_SECRET protects the webhook, so it must be at least 16 characters.
 * STEP 2: Only the "local" storage driver exists for now. Anything else is rejected.
 * STEP 3: Every numeric setting is validated, so a typo fails at startup, not at 3 AM.
 */
const internalSecret = required('INTERNAL_SECRET');
if (internalSecret.length < 16) {
  throw new Error('INTERNAL_SECRET must be at least 16 characters');
}

const storageDriver = process.env.STORAGE_DRIVER || 'local';
if (storageDriver !== 'local') {
  throw new Error(`Unsupported STORAGE_DRIVER "${storageDriver}" (only "local" exists)`);
}

export const env = {
  port: Number(process.env.PORT) || 4007,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  roomServiceUrl: required('ROOM_SERVICE_URL'),
  sfuServiceUrl: required('SFU_SERVICE_URL'),
  internalSecret,
  recordingDir: process.env.RECORDING_DIR || '/recordings',
  storageDriver,

  // Finalize worker (10.6)
  finalizeConcurrency: intFromEnv('FINALIZE_CONCURRENCY', 1, 1),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  ffmpegTimeoutMs: intFromEnv('FFMPEG_TIMEOUT_MS', 30 * 60_000, 1000),

  // Limits and retention (10.11)
  maxRecordingMinutes: intFromEnv('MAX_RECORDING_MINUTES', 240, 1),
  rawRetentionHours: intFromEnv('RAW_RETENTION_HOURS', 24, 0),

  // Disk guard (10.11), values in megabytes. 0 disables the emergency stop.
  diskWarnFreeMb: intFromEnv('DISK_WARN_FREE_MB', 5120, 0),
  diskCriticalFreeMb: intFromEnv('DISK_CRITICAL_FREE_MB', 2048, 0),
  diskEmergencyFreeMb: intFromEnv('DISK_EMERGENCY_FREE_MB', 0, 0),

  // Recovery and cleanup (10.11)
  maintenanceIntervalMinutes: intFromEnv('MAINTENANCE_INTERVAL_MINUTES', 5, 1),
  cleanupIntervalMinutes: intFromEnv('CLEANUP_INTERVAL_MINUTES', 60, 1),
  captureGraceSeconds: intFromEnv('CAPTURE_GRACE_SECONDS', 120, 10),
  staleStartingSeconds: intFromEnv('STALE_STARTING_SECONDS', 120, 10),
  staleProcessingMinutes: intFromEnv('STALE_PROCESSING_MINUTES', 30, 1),
  maxProcessingHours: intFromEnv('MAX_PROCESSING_HOURS', 6, 1),
};