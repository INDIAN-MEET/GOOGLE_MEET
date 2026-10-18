import express from 'express';
import helmet from 'helmet';
import internalRoutes from './routes/internalRoutes.js';
import recordingRoutes from './routes/recordingRoutes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

/**
 * app.ts
 * STEP 1: Security headers and JSON body parsing (1 MB limit is plenty for a manifest).
 * STEP 2: /health for Docker.
 * STEP 3: User routes under /v1/recordings, SFU routes under /internal.
 * STEP 4: 404 handler, then the error handler (always last).
 */
export const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'recording-service' });
});

app.use('/v1/recordings', recordingRoutes);
app.use('/internal', internalRoutes);

app.use(notFound);
app.use(errorHandler);