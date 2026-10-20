import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { PathSecurityError, resolveInsideRoot, UUID_RE } from './paths.ts';
import type { SendOptions, StorageDriver, StoredFileInfo } from './types.ts';

/**
 * Storage driver that keeps files on a local or mounted-volume directory.
 */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  /**
   * Creates the driver.
   *
   * @param root - Absolute or relative recordings root directory.
   */
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Resolves a key to an absolute path, enforcing the root boundary.
   *
   * @param key - Storage key.
   * @returns The absolute path.
   * @throws PathSecurityError when the key escapes the root.
   */
  private resolve(key: string): string {
    return resolveInsideRoot(this.root, key);
  }

  /**
   * Keeps the file where it is when it is already inside the root, otherwise copies it in.
   *
   * @param localPath - Absolute path of the finished file.
   * @param key - Wanted storage key.
   * @returns A promise resolving to the key.
   * @throws PathSecurityError when the key escapes the root.
   */
  async save(localPath: string, key: string): Promise<string> {
    const target = this.resolve(key);
    if (path.resolve(localPath) !== target) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(localPath, target);
    }
    return key;
  }

  /**
   * Returns the size of a stored file.
   *
   * @param key - Storage key.
   * @returns A promise resolving to `{ sizeBytes }`, or null if missing or not a file.
   * @throws PathSecurityError when the key escapes the root.
   */
  async stat(key: string): Promise<StoredFileInfo | null> {
    const info = await stat(this.resolve(key)).catch(() => null);
    return info && info.isFile() ? { sizeBytes: info.size } : null;
  }

  /**
   * Streams a file with `res.sendFile` (handles Range, ETag, and backpressure).
   *
   * STEP 1: Resolve the key safely, split into directory and file name.
   * STEP 2: If a download name is given, set Content-Disposition: attachment.
   * STEP 3: Stream; a client that disconnects is not an error.
   *
   * @param key - Storage key.
   * @param res - Express response.
   * @param options - Optional download name.
   * @returns A promise that resolves when streaming ends.
   * @throws PathSecurityError or the filesystem error when streaming cannot start.
   */
  send(key: string, res: Response, options: SendOptions = {}): Promise<void> {
    const absolute = this.resolve(key);
    if (options.downloadName) res.attachment(options.downloadName);
    return new Promise<void>((resolve, reject) => {
      /**
       * Completion callback of sendFile.
       *
       * @param err - Error, if streaming failed.
       */
      const done = (err?: Error): void => {
        if (err && !res.headersSent) reject(err);
        else resolve();
      };
      res.sendFile(
        path.basename(absolute),
        { root: path.dirname(absolute), acceptRanges: true, cacheControl: false, headers: { 'Cache-Control': 'private, no-store' } },
        done,
      );
    });
  }

  /**
   * Removes one file. A missing file is not an error.
   *
   * @param key - Storage key.
   * @returns A promise that resolves when the file is gone.
   * @throws PathSecurityError when the key escapes the root.
   */
  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /**
   * Removes the whole recording directory.
   *
   * @param recordingId - Recording id.
   * @returns A promise that resolves when the directory is gone.
   * @throws PathSecurityError when the id is not a UUID.
   */
  async removeRecording(recordingId: string): Promise<void> {
    if (!UUID_RE.test(recordingId)) throw new PathSecurityError('Invalid recording id');
    await rm(this.resolve(recordingId), { recursive: true, force: true });
  }
}
