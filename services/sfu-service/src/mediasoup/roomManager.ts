import * as mediasoup from 'mediasoup';
import { mediasoupConfig } from '../config/mediasoup.ts';
import { getNextWorker } from './workerPool.ts';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';

// Promise store karte hain (Router nahi), taaki 2 requests ek saath
// aayein to bhi ek room ke 2 Router na bane

const routers = new Map<string, Promise<mediasoup.types.Router>>();

export function getOrCreateRouter(
    roomId: string,
): Promise<mediasoup.types.Router> {
    let routerPromise = routers.get(roomId)

    if (!routerPromise) {
        routerPromise = getNextWorker()
            .createRouter(mediasoupConfig.router)
            .then(router => {
                logger.info({ roomId, routerId: router.id }, 'Router created for room');
                return router
            })
            .catch(err => {
                routers.delete(roomId); //fail try again 
                throw new AppError('Failed to create Router', 500)
            })

        routers.set(roomId, routerPromise)
    }

    return routerPromise;
}


export async function closeRoom(roomId: string): Promise<void> {
    const routerPromise = routers.get(roomId)

    if (!routerPromise) {
        logger.error({ roomId }, 'Room not found');
        return
    }

    const router = await routerPromise
    
    router.close();
    routers.delete(roomId);
    logger.info({ roomId }, 'Router closed');
}
