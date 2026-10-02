import express from 'express';
import sfuRoutes from './routes/sfuRoutes.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { authGuard } from './middleware/authGuard.ts';
import { devCors } from './middleware/devCors.ts';

/**
 * app.ts
 *
 * STEP 1: Create the Express app and parse JSON bodies.
 *
 * STEP 2: devCors FIRST (dev only). It must run before authGuard so
 *         the OPTIONS preflight is answered without a secret.
 *
 * STEP 3: /health stays OPEN (no secret), because the Docker
 *         healthcheck cannot send one.
 *
 * STEP 4: Mount the SFU API behind authGuard.
 *         Every /api/v1/sfu route now needs x-internal-secret.
 *
 * STEP 5: errorHandler LAST, so it catches everything above.
 */
const app = express();

app.use(express.json());                                  // STEP 1
app.use(devCors);                                         // STEP 2

app.get('/health', (_req, res) => {                       // STEP 3
  res.status(200).json({ status: 'ok' });
});

app.use('/api/v1/sfu', authGuard, sfuRoutes);             // STEP 4

app.use(errorHandler);                                    // STEP 5

export default app;