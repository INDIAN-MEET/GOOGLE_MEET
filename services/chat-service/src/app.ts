import express from 'express';
import type { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { errorHandler } from './middleware/errorHandler.ts';
import logger from './utils/logger.ts';
import chatRoutes from './routes/chatRoutes.ts';

const app = express();

app.use(express.json());
app.use(pinoHttp({ logger }));

/**
 * @description Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'chat-service' });
});

/**
 * @description API v1 chat routes
 */
app.use('/api/v1/chat', chatRoutes);

/**
 * @description Global error handler
 */
app.use(errorHandler);

export default app;