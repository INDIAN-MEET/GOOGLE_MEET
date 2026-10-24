import { Worker, type Job } from "bullmq";
import { env } from "../config/env.ts";
import { createRedis } from "../config/redis.ts";
import { prisma } from "../config/prisma.ts";
import { sendEmail } from "../email/sendEmail.ts";
import { renderInvite, renderReminder } from "../email/templates.ts";
import { logger } from "../utils/logger.ts";
import { EMAIL_QUEUE_NAME, type EmailJobData } from "./queues.ts";

/**
 * Process one email job.
 *
 * Steps:
 *  1. Load the Notification row.
 *  2. Skip if it is missing or no longer PENDING (cancelled / already sent).
 *  3. Render the correct template and send it.
 *  4. Mark the row SENT.
 *
 * Any thrown error makes BullMQ retry according to the queue's backoff.
 *
 * @param job BullMQ job containing the notification id.
 */
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const row = await prisma.notification.findUnique({ where: { id: job.data.notificationId } });

  if (!row) {
    logger.warn({ jobId: job.id }, "Notification row missing, skipping");
    return;
  }
  if (row.status !== "PENDING") {
    logger.info({ id: row.id, status: row.status }, "Notification not pending, skipping");
    return;
  }

  // Count this attempt before sending so failures are visible in the DB.
  await prisma.notification.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
  });

  const ctx = {
    roomCode: row.roomCode,
    roomTitle: row.roomTitle,
    hostName: row.hostName,
    message: row.message,
    meetingAt: row.meetingAt,
    minutesBefore:
      row.type === "REMINDER" && row.meetingAt
        ? Math.max(1, Math.round((row.meetingAt.getTime() - row.sendAt.getTime()) / 60000))
        : undefined,
  };

  const email = row.type === "INVITE" ? renderInvite(ctx) : renderReminder(ctx);
  const messageId = await sendEmail(row.recipientEmail, email);

  await prisma.notification.update({
    where: { id: row.id },
    data: { status: "SENT", sentAt: new Date(), lastError: null },
  });

  logger.info({ id: row.id, type: row.type, messageId }, "Email sent");
}

/**
 * Start the email worker. Call once at boot.
 *
 * @returns The BullMQ Worker so the caller can close it on shutdown.
 */
export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: createRedis("bullmq-worker", true),
    concurrency: env.emailQueueConcurrency,
  });

  // Called after EVERY failed attempt. Record the error text each time.
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade >= maxAttempts;

    logger.warn(
      { notificationId: job.data.notificationId, attempt: job.attemptsMade, maxAttempts, err: err.message },
      "Email job failed",
    );

    await prisma.notification
      .update({
        where: { id: job.data.notificationId },
        data: { lastError: err.message.slice(0, 500), ...(isFinal ? { status: "FAILED" } : {}) },
      })
      .catch((e) => logger.error({ e }, "Could not record failure"));
  });

  worker.on("error", (err) => logger.error({ err }, "Worker error"));
  return worker;
}