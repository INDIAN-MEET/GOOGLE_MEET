import express from 'express';
import sfuRoutes from './routes/sfuRoutes.ts';
import { errorHandler } from './middleware/errorHandler.ts';

export const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/sfu', sfuRoutes);

app.use(errorHandler);