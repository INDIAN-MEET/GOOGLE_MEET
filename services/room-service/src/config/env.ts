import 'dotenv/config';

export const PORT: string = process.env.PORT || '4003';
export const DATABASE_URL: string = process.env.DATABASE_URL as string;
export const JWT_ACCESS_SECRET: string = process.env.JWT_ACCESS_SECRET as string;
export const NODE_ENV: string = process.env.NODE_ENV as string;