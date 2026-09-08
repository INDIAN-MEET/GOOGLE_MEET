import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import proxyRoutes from './routes/proxyRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { FRONTEND_URL } from './config/env.js';
import logger from './utils/logger.js';

const app = express();


app.use(express.json());
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(pinoHttp({ logger }));

app.get('/health', (req, res) => {
    logger.info('Health check');
    res.json({ status: 'ok', service: 'api-gateway' })
});

app.use('/api', proxyRoutes);

app.use(errorHandler);

export default app;