import 'dotenv/config';

export const PORT = process.env.PORT || 4005;
export const MONGO_URI = process.env.MONGO_URI as string;
export const REDIS_URL = process.env.REDIS_URL as string;
export const GATEWAY_SECRET = process.env.GATEWAY_SECRET as string;
export const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL as string;
export const NODE_ENV = process.env.NODE_ENV || 'development';