import express from 'express';
import type { Request, Response } from 'express';
import { pinoHttp } from 'pino-http';

import { errorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import chatRoutes from './routes/chatRoutes.js';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';

const app = express();

app.use(express.json());

// Pino HTTP logger
app.use(pinoHttp({ logger }));
app.use(httpMetricsMiddleware());
app.get('/metrics', metricsHandler);

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        service: 'chat-service',
    });
});

// API v1 chat routes
app.use('/api/v1/chat', chatRoutes);

// Global error handler
app.use(errorHandler);

export default app;