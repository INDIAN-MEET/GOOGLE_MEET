import path from 'node:path';

/** Strict UUID matcher used for recording and segment ids. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Error raised when a path would leave the recordings root.
 */
export class PathSecurityError extends Error {
  /**
   * Creates the error.
   *
   * @param message - Human readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'PathSecurityError';
  }
}

/**
 * Resolves a path (absolute or relative to `root`) and guarantees the result is
 * strictly inside `root`.
 *
 * STEP 1: Reject NUL bytes.
 * STEP 2: Resolve to an absolute path (".." is collapsed here).
 * STEP 3: Compute the relative path from the root. If it starts with ".." the path escaped.
 *
 * @param root - Recordings root directory.
 * @param candidate - Path or storage key to check.
 * @returns The absolute, normalised path inside the root.
 * @throws PathSecurityError when the path is outside the root or is the root itself.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  if (candidate.includes('\0')) throw new PathSecurityError('Invalid path');
  const absoluteRoot = path.resolve(root);
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathSecurityError('Path escapes the recordings root');
  }
  return absolute;
}

/**
 * Converts an absolute path inside the root to the storage key saved in the database.
 *
 * @param root - Recordings root directory.
 * @param absolutePath - Absolute file path inside the root.
 * @returns A forward-slash key relative to the root, e.g. "<id>/final/0-peer-camera.mp4".
 */
export function toStorageKey(root: string, absolutePath: string): string {
  return path.relative(path.resolve(root), absolutePath).split(path.sep).join('/');
}

/**
 * Makes a string safe to use as a file name.
 *
 * @param name - Raw name (for example a file base name).
 * @returns The name with unsafe characters replaced by "_", at most 120 characters.
 */
export function sanitizeFileStem(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}