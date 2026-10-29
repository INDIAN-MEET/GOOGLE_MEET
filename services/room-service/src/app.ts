import express from 'express';
import roomRoutes from './routes/roomRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';

const app = express();

app.use(express.json());
app.use(httpMetricsMiddleware());
app.get('/metrics', metricsHandler);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'room-service' }));

app.use('/v1', roomRoutes);

app.use(errorHandler);

export default app;