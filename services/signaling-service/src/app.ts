import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics.js';


const app = express();

app.use(httpMetricsMiddleware());
app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'signaling-service' }));

app.use(errorHandler); // hamesha sabse last

export default app;