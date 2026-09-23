import express from 'express';
import { errorHandler } from './middleware/errorHandler.ts';

export const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Aage yahan sfuRoutes lagenge (Step 5)

app.use(errorHandler);

