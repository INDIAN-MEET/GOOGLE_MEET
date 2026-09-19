import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';


const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'signaling-service' }));

app.use(errorHandler); // hamesha sabse last

export default app;