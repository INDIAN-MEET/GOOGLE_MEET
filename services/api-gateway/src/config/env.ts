import 'dotenv/config';

export const PORT: string = process.env.PORT || '4000';
export const AUTH_SERVICE_URL: string = process.env.AUTH_SERVICE_URL as string;
export const USER_SERVICE_URL: string = process.env.USER_SERVICE_URL as string;
export const ROOM_SERVICE_URL: string = process.env.ROOM_SERVICE_URL as string;
export const FRONTEND_URL: string = process.env.FRONTEND_URL as string;
export const JWT_ACCESS_SECRET: string = process.env.JWT_ACCESS_SECRET as string;
export const NODE_ENV: string = process.env.NODE_ENV as string;