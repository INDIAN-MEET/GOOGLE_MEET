import { createApp } from "./src/app.ts";
import { env } from "./src/config/env.ts";
import { prisma } from "./src/config/prisma.ts";
import { queueRedis, redis } from "./src/config/redis.ts";
import { emailQueue } from "./src/queue/queues.ts";
import { startEmailWorker } from "./src/queue/emailWorker.ts";
import { startRoomEventsSubscriber } from "./src/subscribers/roomEventsSubscriber.ts";
import { logger } from "./src/utils/logger.ts";

/**
 * Boot sequence:
 *  1. Start the HTTP server.
 *  2. Start the email worker (consumes the queue).
 *  3. Start the Redis subscriber (reacts to room events).
 *  4. Register graceful shutdown so in-flight emails finish.
 */
async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(env.port, () => logger.info({ port: env.port }, "notification-service listening"));

  const worker = startEmailWorker();
  const subscriber = startRoomEventsSubscriber();

  /**
   * Graceful shutdown: stop accepting work, let running jobs finish, close
   * connections, then exit. Triggered by Docker/Kubernetes with SIGTERM.
   */
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Shutting down");
    server.close();
    await worker.close();      // waits for active jobs
    await emailQueue.close();
    subscriber.disconnect();
    queueRedis.disconnect();
    redis.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});