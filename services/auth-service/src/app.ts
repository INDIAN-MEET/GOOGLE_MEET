import express, { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser'
import { errorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import v1Routes from './routes/v1/index.js';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';

const app = express();

app.use(express.json());
app.use(cookieParser())
app.use(pinoHttp({ logger }));
app.use(httpMetricsMiddleware());
app.get('/metrics', metricsHandler);
/**  
 * * @description Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'auth-service' });
});
/** 
 * @description API v1 routes
 */
app.use('/api/v1', v1Routes);

/**
 * @description Global error handler
 */
app.use(errorHandler)

export default app;