// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';

import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './src/app.js';
import { PORT } from './src/config/env.js';
import { initSocket } from './src/socket/index.js';
import logger from './src/utils/logger.js';
import { instrumentSocketServer } from './src/observability/signalingMetrics.js';


const server = createServer(app)

const io = new Server(server, { cors: { origin: '*' } });
instrumentSocketServer(io);

initSocket(io);

server.listen(PORT, () => {
    logger.info(`Signaling Service running on port https://localhost:${PORT}`);
});