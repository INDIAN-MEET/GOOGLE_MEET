import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { health, ready } from "./controllers/healthController.ts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { notificationRoutes } from "./routes/notificationRoutes.ts";
import { logger } from "./utils/logger.ts";
import { asyncHandler } from "./utils/asyncHandler.ts";
import { httpMetricsMiddleware, metricsHandler } from "./observability/metrics.js";

/**
 * Build the Express application (no listening here, so it can be tested).
 *
 * @returns Configured Express app.
 */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "100kb" })); // invites are small
  app.use(pinoHttp({ logger }));
  app.use(httpMetricsMiddleware());
  app.get("/metrics", metricsHandler);

  app.get("/health", health);
  app.get("/ready", asyncHandler(async (req, res) => ready(req, res)));

  app.use("/v1/notifications", notificationRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}