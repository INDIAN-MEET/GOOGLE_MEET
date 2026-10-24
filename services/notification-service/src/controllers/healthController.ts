import type { Request, Response } from "express";
import { prisma } from "../config/prisma.ts";
import { redis } from "../config/redis.ts";
import { smtpIsReady } from "../email/transporter.ts";

/**
 * GET /health: liveness. Answers "is the process running?". No dependencies,
 * so Kubernetes does not restart the pod because a database is slow.
 */
export function health(_req: Request, res: Response): void {
    res.json({ status: "ok" });
}

/**
 * GET /ready: readiness. Answers "can it serve traffic right now?".
 * Checks Postgres, Redis and SMTP and returns 503 if any is down.
 */

export async function ready(_req: Request, res: Response): Promise<void> {
    const checks = {
        postgres: await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        redis: await redis.ping().then((r) => r === "PONG").catch(() => false),
        smtp: await smtpIsReady(),
    };
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "not_ready", checks });
}