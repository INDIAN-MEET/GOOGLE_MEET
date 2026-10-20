import { spawn } from 'node:child_process';
import { env } from '../config/env.ts';

const MAX_STDOUT_CHARS = 1_000_000;
const STDERR_TAIL_CHARS = 8_000;

export type MediaToolErrorKind = 'not-found' | 'timeout' | 'exit' | 'spawn';

/**
 * Error raised when ffmpeg or ffprobe cannot finish successfully.
 * The message is short and safe to store; the raw stderr is kept in `stderr` for logs only.
 */
export class MediaToolError extends Error {
  readonly kind: MediaToolErrorKind;
  readonly stderr: string;
  readonly exitCode: number | null;

  /**
   * Creates the error.
   *
   * @param message - Short, path-free reason.
   * @param kind - Failure category (decides retry behaviour).
   * @param stderr - Tail of the tool's stderr output.
   * @param exitCode - Process exit code, or null if it never ran.
   */
  constructor(message: string, kind: MediaToolErrorKind, stderr = '', exitCode: number | null = null) {
    super(message);
    this.name = 'MediaToolError';
    this.kind = kind;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export interface ProbeResult {
  durationSec: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a binary WITHOUT a shell (arguments are passed as an array, so nothing is interpolated).
 *
 * STEP 1: Spawn the process with a hard timeout (SIGKILL when exceeded).
 * STEP 2: Keep only the tail of stderr and a capped stdout.
 * STEP 3: Resolve on exit code 0, otherwise reject with a MediaToolError.
 *
 * @param binary - Executable name or path.
 * @param args - Argument list.
 * @param timeoutMs - Maximum run time in milliseconds.
 * @param captureStdout - Whether stdout is needed (ffprobe) or ignored (ffmpeg).
 * @returns A promise resolving to the captured output.
 * @throws MediaToolError when the binary is missing, times out, or exits non-zero.
 */
function runProcess(
  binary: string,
  args: string[],
  timeoutMs: number,
  captureStdout: boolean,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    /**
     * Collects stdout text up to a fixed cap.
     *
     * @param chunk - Data chunk from the child process.
     */
    const onStdout = (chunk: Buffer): void => {
      if (stdout.length < MAX_STDOUT_CHARS) stdout += chunk.toString();
    };

    /**
     * Keeps the last STDERR_TAIL_CHARS characters of stderr.
     *
     * @param chunk - Data chunk from the child process.
     */
    const onStderr = (chunk: Buffer): void => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    };

    /**
     * Handles spawn failures such as a missing executable (ENOENT).
     *
     * @param err - Error emitted by the child process.
     */
    const onError = (err: NodeJS.ErrnoException): void => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const missing = err.code === 'ENOENT';
      reject(
        new MediaToolError(
          missing ? `${binary} was not found` : `Failed to start ${binary}`,
          missing ? 'not-found' : 'spawn',
        ),
      );
    };

    /**
     * Handles process exit: success, timeout, or non-zero exit code.
     *
     * @param code - Exit code, or null when killed by a signal.
     */
    const onClose = (code: number | null): void => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut) {
        reject(new MediaToolError(`${binary} timed out`, 'timeout', stderr, code));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new MediaToolError(`${binary} exited with code ${code}`, 'exit', stderr, code));
      }
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
  });
}

/**
 * Runs ffmpeg with safe defaults (no stdin, errors only).
 *
 * @param args - ffmpeg arguments (without the binary name).
 * @param timeoutMs - Maximum run time, defaults to FFMPEG_TIMEOUT_MS.
 * @returns A promise that resolves when ffmpeg exits with code 0.
 * @throws MediaToolError on failure.
 */
export async function runFfmpeg(args: string[], timeoutMs = env.ffmpegTimeoutMs): Promise<void> {
  await runProcess(env.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], timeoutMs, false);
}

/**
 * Converts a numeric string from ffprobe into a number.
 *
 * @param value - Value that may be a numeric string or undefined.
 * @returns The finite number, or null.
 */
function toNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Inspects a media file with ffprobe.
 *
 * @param filePath - Absolute path of the file to inspect.
 * @returns A promise resolving to stream information and duration.
 * @throws MediaToolError when ffprobe fails, or the output is not valid JSON.
 */
export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { stdout } = await runProcess(
    env.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    60_000,
    true,
  );

  let parsed: { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new MediaToolError('ffprobe returned invalid output', 'exit');
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const streamDuration = toNumberOrNull(video?.duration) ?? toNumberOrNull(audio?.duration);

  return {
    durationSec: toNumberOrNull(parsed.format?.duration) ?? streamDuration,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: toNumberOrNull(video?.width),
    height: toNumberOrNull(video?.height),
    videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : null,
    audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : null,
  };
}
