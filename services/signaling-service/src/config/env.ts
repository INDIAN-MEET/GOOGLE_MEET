import 'dotenv/config';

/**
 * env.ts
 *
 * STEP 1: Read INTERNAL_SECRET. It must be the SAME value the SFU uses,
 *         or every SFU call gets a 401.
 *
 * STEP 2: Fail at startup if it is missing or shorter than 16
 *         characters, so the mistake shows on boot and not on the
 *         first user call.
 *
 * STEP 3: SFU_SERVICE_URL: Docker sets http://sfu-service:4006.
 *         Without Docker it falls back to http://localhost:4006.
 */
export const PORT: string = process.env.PORT || '4004';
export const JWT_ACCESS_SECRET: string = process.env.JWT_ACCESS_SECRET as string;
export const REDIS_URL: string = process.env.REDIS_URL as string;
export const ROOM_SERVICE_URL: string = process.env.ROOM_SERVICE_URL as string;
export const NODE_ENV: string = process.env.NODE_ENV as string;

export const INTERNAL_SECRET: string = process.env.INTERNAL_SECRET ?? '';        // STEP 1

if (INTERNAL_SECRET.length < 16) {                                               // STEP 2
    throw new Error('INTERNAL_SECRET is missing or shorter than 16 characters');
}

export const SFU_SERVICE_URL: string =                                           // STEP 3
    process.env.SFU_SERVICE_URL || 'http://localhost:4006';