import express from 'express';
import type { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import morgan from 'morgan';

import { errorHandler } from './middleware/errorHandler.ts';
import logger from './utils/logger.ts';
import chatRoutes from './routes/chatRoutes.ts';

const app = express();

app.use(express.json());

// HTTP request logger
app.use(
    morgan('dev', {
        stream: {
            write: (message:any) => {
                process.stdout.write(`[HTTP] ${message}`);
            },
        },
    })
);

// Pino HTTP logger
app.use(pinoHttp({ logger }));

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