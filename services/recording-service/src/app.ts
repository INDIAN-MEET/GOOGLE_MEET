import express from 'express';
import helmet from 'helmet';
import internalRoutes from './routes/internalRoutes.ts';
import recordingRoutes from './routes/recordingRoutes.ts';
import { errorHandler, notFound } from './middleware/errorHandler.ts';
import { readiness } from './controllers/healthController.ts';
import { asyncHandler } from './utils/asyncHandler.ts';

/**
 * app.ts
 * STEP 1: Security headers and JSON body parsing (1 MB limit is plenty for a manifest).
 * STEP 2: /health for Docker, /ready for readiness.
 * STEP 3: User routes under /v1/recordings, SFU routes under /internal.
 * STEP 4: 404 handler, then the error handler (always last).
 */
export const app = express();

app.use(helmet());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-internal-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'recording-service' });
});

app.get('/ready', asyncHandler(readiness));

app.use('/v1/recordings', recordingRoutes);
app.use('/internal/recordings', internalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;