import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 4006,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  numWorkers: Number(process.env.NUM_WORKERS) || 2,
  rtcMinPort: Number(process.env.RTC_MIN_PORT) || 40000,
  rtcMaxPort: Number(process.env.RTC_MAX_PORT) || 40100,
  announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
};
