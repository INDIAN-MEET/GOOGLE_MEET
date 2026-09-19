import mongoose from 'mongoose';
import { MONGO_URI } from './env.ts';
import logger from '../utils/logger.ts';

/**  
 * Connect to MongoDB
 * @returns {Promise<void>}
 * @description Connect to MongoDB
 * @function connectDb
 */
async function connectDb():Promise<void>{
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('[chat-service] MongoDB connected');
    } catch (err:any) {
        logger.error('[chat-service] MongoDB connection failed', err);
        process.exit(1);
    }

}

export default connectDb;