import pino from "pino";
import { env } from "../config/env.ts";

/** Structured JSON logger. Pretty printing is left to `| pino-pretty` in dev. */
export const logger = pino({
  level: env.isProd ? "info" : "debug",
  base: { service: "notification-service" },
});