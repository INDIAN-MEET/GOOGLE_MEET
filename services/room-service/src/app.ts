import express from 'express';
import roomRoutes from './routes/roomRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'room-service' }));

app.use('/v1', roomRoutes);

app.use(errorHandler);

export default app;