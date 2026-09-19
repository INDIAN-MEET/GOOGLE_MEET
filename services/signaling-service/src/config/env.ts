import 'dotenv/config';

export const PORT: string = process.env.PORT || '4004';
export const JWT_ACCESS_SECRET: string = process.env.JWT_ACCESS_SECRET as string;
export const REDIS_URL: string = process.env.REDIS_URL as string;
export const ROOM_SERVICE_URL: string = process.env.ROOM_SERVICE_URL as string;
export const NODE_ENV: string = process.env.NODE_ENV as string;