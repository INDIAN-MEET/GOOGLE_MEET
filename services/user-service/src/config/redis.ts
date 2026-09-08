import Redis from 'ioredis';
import { REDIS_URL } from './env.js';
import prisma from './db.js';
import logger from '../utils/logger.js';


const subscriber = new Redis(REDIS_URL)


subscriber.subscribe('user-created', (err: any) => {
    if (err) logger.error('Redis subscribe error:', err)
    else logger.info('Subscribed to user-created channel')
})

subscriber.on('message', async (channel, message) => {
    if (channel === 'user-created') {
        try {
            const { userId } = JSON.parse(message)
            await prisma.profile.create({ data: { userId } })
            logger.info(`Profile auto-created for userId: ${userId}`);
        } catch (err: any) {
            logger.error('Failed to create profile from event:', err);
        }
    }
})


export default subscriber;