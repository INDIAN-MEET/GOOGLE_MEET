import { Redis } from 'ioredis';
import { env } from './env.js';

/**
 * redis.ts
 *
 * STEP 1: One shared connection for normal commands (lock, publish).
 * STEP 2: lockKey(roomCode) builds the key "recording:active:<roomCode>".
 *         Signaling reads this same key later so late joiners see the REC state.
 * STEP 3: acquireLock uses SET ... NX EX 14400.
 *         NX = only set if the key does not exist, so the second caller loses.
 *         EX 14400 = auto-expire after 4 hours, so a crash cannot lock a room forever.
 * STEP 4: releaseLock deletes the key ONLY if it still holds OUR recordingId,
 *         so we never delete the lock of a newer recording.
 */

export const redis = new Redis(env.redisUrl);

export const lockKey = (roomCode: string) => `recording:active:${roomCode}`;


export async function acquireLock(roomCode: string, recordingId: string): Promise<boolean> {

    const result = await redis.set(lockKey(roomCode), recordingId, 'EX', 14400, 'NX')
    return result === 'OK';

}


export async function releaseLock(roomCode: string, recordingId: string): Promise<void> {
  const current = await redis.get(lockKey(roomCode));
  if (current === recordingId) await redis.del(lockKey(roomCode));
}