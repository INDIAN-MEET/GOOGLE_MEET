import express from 'express';
import profileRoutes from './routes/profileRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import './config/redis.js'; // side-effect import — subscriber start hota hai
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';

const app = express();
app.use(express.json());
app.use(httpMetricsMiddleware());
app.get('/metrics', metricsHandler);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'user-service' }));
app.use('/', profileRoutes);

app.use(errorHandler);
export default app;