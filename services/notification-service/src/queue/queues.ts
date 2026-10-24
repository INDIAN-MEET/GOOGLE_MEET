import { Queue } from "bullmq";
import { env } from "../config/env.ts";
import { queueRedis } from "../config/redis.ts";

/** Name shared by the queue and the worker. */
export const EMAIL_QUEUE_NAME = "notification-email";

/** Payload stored in each job. Only the DB id, so the DB stays the source of truth. */
export interface EmailJobData {
  notificationId: string;
}

/**
 * The email queue (producer side).
 *
 * Default job options:
 *  - attempts + exponential backoff: transient SMTP failures retry automatically.
 *  - removeOnComplete/removeOnFail: keep Redis small; history lives in Postgres.
 */

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: env.emailMaxAttempts,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
