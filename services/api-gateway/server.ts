// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';

import http from 'node:http';
import app from './src/app.js';
import redis from './src/config/redis.js';
import { PORT } from './src/config/env.js';
import logger from './src/utils/logger.js';

const server = http.createServer(app);

// Protection against slow-connection attacks (slowloris).
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000;

server.listen(Number(PORT), () => {
  logger.info(`API Gateway running on port ${PORT}`);
});

/** Prevents running the shutdown logic twice. */
let shuttingDown = false;

/**
 * Stops the gateway cleanly: stop new connections, let running requests finish,
 * close Redis, then exit. Forces exit after 10 seconds.
 *
 * @param reason   - Why we are stopping (signal name or error type).
 * @param exitCode - 0 = normal, 1 = error.
 */
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'Shutting down');

  const forceTimer = setTimeout(() => {
    logger.error('Shutdown took too long, forcing exit');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close(async () => {
    try {
      await redis.quit();
    } catch {
      /* Redis may already be down. */
    }
    clearTimeout(forceTimer);
    logger.info('Shutdown complete');
    process.exit(exitCode);
  });

  server.closeIdleConnections();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});