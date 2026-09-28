import express from 'express';
import sfuRoutes from './routes/sfuRoutes.ts';
import { errorHandler } from './middleware/errorHandler.ts';

export const app = express();

app.use(express.json());
// DEV ONLY: allow the browser test page. Remove before Step 10 (auth).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/sfu', sfuRoutes);

app.use(errorHandler);