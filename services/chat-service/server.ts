// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';

import app from './src/app.js';
import { PORT } from './src/config/env.js';
import  connectDB  from './src/config/db.js';
import { startChatMessageSubscriber } from './src/subscribers/chatMessageSubscriber.js';
import logger from './src/utils/logger.js';

async function startServer() {
    await connectDB();
    await startChatMessageSubscriber();

    app.listen(PORT, () => {
        logger.info(`[chat-service] running on port ${PORT}`);
    });
}

startServer();