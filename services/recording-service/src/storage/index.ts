import { env } from '../config/env.ts';
import { LocalStorageDriver } from './localStorage.ts';
import type { StorageDriver } from './types.ts';

/**
 * The storage driver used by the whole service. env.ts already rejected unknown drivers,
 * so "local" is the only value that can reach this point.
 */
export const storage: StorageDriver = new LocalStorageDriver(env.recordingDir);
