import { Redis } from "ioredis";
import { env } from "./env.ts";
import { logger } from "../utils/logger.ts";

/**
 * Create a new Redis connection.
 *
 * @param name Label used in logs so you can tell connections apart.
 * @param forBullMQ When true, sets `maxRetriesPerRequest: null`, which BullMQ requires.
 * @returns A connected ioredis client.
 */

export function createRedis(name: string, forBullMQ = false): Redis {
    const client = new Redis(env.redisUrl, {
        maxRetriesPerRequest: forBullMQ ? null : 3,
        enableReadyCheck: true,
    });

    client.on("error", (err) => logger.error({ err, name }, "Redis error"));
    client.on("ready", () => logger.info({ name }, "Redis ready"));

    return client
}

/** Connection used by the BullMQ Queue (producer side). */
export const queueRedis = createRedis("bullmq-queue", true);

/** Plain connection for health checks and ad-hoc commands. */
export const redis = createRedis("general");
