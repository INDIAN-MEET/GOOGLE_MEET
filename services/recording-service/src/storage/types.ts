import type { Response } from 'express';

export interface StoredFileInfo {
  sizeBytes: number;
}

export interface SendOptions {
  /** When set, the response is a download with this file name. */
  downloadName?: string;
}

export interface StorageDriver {
  /**
   * Stores a finished local file under a key.
   *
   * @param localPath - Absolute path of the finished file.
   * @param key - Storage key to save it under.
   * @returns A promise resolving to the key saved in the database.
   */
  save(localPath: string, key: string): Promise<string>;

  /**
   * Looks up a stored file.
   *
   * @param key - Storage key.
   * @returns A promise resolving to file info, or null when the file does not exist.
   */
  stat(key: string): Promise<StoredFileInfo | null>;

  /**
   * Streams a stored file to the HTTP response (with Range support).
   *
   * @param key - Storage key.
   * @param res - Express response.
   * @param options - Download options.
   * @returns A promise that resolves when streaming ends.
   */
  send(key: string, res: Response, options?: SendOptions): Promise<void>;

  /**
   * Deletes one stored file. Never throws when it is already gone.
   *
   * @param key - Storage key.
   * @returns A promise that resolves when the file is gone.
   */
  remove(key: string): Promise<void>;

  /**
   * Deletes everything stored for a recording (raw, final, thumbnail, manifest).
   *
   * @param recordingId - Recording id (must be a UUID).
   * @returns A promise that resolves when the data is gone.
   */
  removeRecording(recordingId: string): Promise<void>;
}
