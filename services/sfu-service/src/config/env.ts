import dotenv from 'dotenv';
dotenv.config();

const internalSecret = process.env.INTERNAL_SECRET ?? '';   // STEP 1

if (internalSecret.length < 16) {                           // STEP 2
  throw new Error('INTERNAL_SECRET is missing or shorter than 16 characters');
}

export const env = {
  port: Number(process.env.PORT) || 4006,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  numWorkers: Number(process.env.NUM_WORKERS) || 2,
  rtcMinPort: Number(process.env.RTC_MIN_PORT) || 40000,
  rtcMaxPort: Number(process.env.RTC_MAX_PORT) || 40100,
  announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
  internalSecret,
  devCorsOrigin: process.env.DEV_CORS_ORIGIN ?? 'http://localhost:3000',

};
