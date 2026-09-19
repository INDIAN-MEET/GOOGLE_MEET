import app from './src/app.ts';
import { PORT } from './src/config/env.ts';
import  connectDB  from './src/config/db.ts';
import { startChatMessageSubscriber } from './src/subscribers/chatMessageSubscriber.ts';
import logger from './src/utils/logger.ts';

async function startServer() {
    await connectDB();
    await startChatMessageSubscriber();

    app.listen(PORT, () => {
        logger.info(`[chat-service] running on port ${PORT}`);
    });
}

startServer();