import 'dotenv/config';

/**
 * env.ts
 *
 * STEP 1: required(name) reads a variable and STOPS the service if it is missing.
 * STEP 2: INTERNAL_SECRET must be at least 16 characters (it protects the webhook).
 * STEP 3: Numbers get safe defaults so a missing optional value does not break anything.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

const internalSecret = required('INTERNAL_SECRET');
if (internalSecret.length < 16) {
  throw new Error('INTERNAL_SECRET must be at least 16 characters');
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
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  finalizeConcurrency: Number(process.env.FINALIZE_CONCURRENCY) || 1,
  maxRecordingMinutes: Number(process.env.MAX_RECORDING_MINUTES) || 240,
  rawRetentionHours: Number(process.env.RAW_RETENTION_HOURS) || 24,
};

