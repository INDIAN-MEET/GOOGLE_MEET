import { prisma } from '../config/prisma.ts';
import { closeQueues, requeueFinalize } from '../queue/queues.ts';
import { UUID_RE } from '../storage/paths.ts';
import { redis } from '../config/redis.ts';

/**
 * CLI: re-runs finalization for a PROCESSING or FAILED recording.
 *
 * STEP 1: Validate the id and load the recording.
 * STEP 2: Reset FAILED segments to PENDING and the recording to PROCESSING (one transaction).
 * STEP 3: Re-queue the job (a finished old job with the same id is replaced).
 *
 * Usage: node dist/src/tools/requeueFinalize.js <recordingId>
 *
 * @returns A promise that resolves when the job is queued (exit code 0) or rejects (exit code 1).
 */
async function main(): Promise<void> {
  const recordingId = process.argv[2] ?? '';
  if (!UUID_RE.test(recordingId)) throw new Error('Usage: requeueFinalize <recordingId (uuid)>');

  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) throw new Error('Recording not found');
  if (recording.status !== 'PROCESSING' && recording.status !== 'FAILED') {
    throw new Error(`Refusing: recording is ${recording.status}`);
  }

  await prisma.$transaction([
    prisma.recordingSegment.updateMany({
      where: { recordingId, status: 'FAILED' },
      data: { status: 'PENDING', error: null },
    }),
    prisma.recording.update({ where: { id: recordingId }, data: { status: 'PROCESSING', error: null } }),
  ]);

  const result = await requeueFinalize(recordingId);
  console.log(JSON.stringify({ recordingId, ...result }));
}

main()
  .then(async () => {
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
