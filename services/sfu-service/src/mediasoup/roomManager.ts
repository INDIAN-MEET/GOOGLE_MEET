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
                logger.error({ err, roomId }, 'Router creation failed');
                routers.delete(roomId); // allow retry
                throw new AppError('Failed to create Router', 500)
            })

        routers.set(roomId, routerPromise)
    }

    return routerPromise;
}


export async function closeRoom(roomId: string): Promise<void> {
  const routerPromise = routers.get(roomId)
  if (!routerPromise) return;

  routers.delete(roomId); // delete first so a new join can create a fresh Router

  try {
    const router = await routerPromise;
    router.close();
    logger.info({ roomId }, 'Router closed');
  } catch (err) {
    logger.warn({ err, roomId }, 'Router was already failed/closed');
  }
}


export async function getRouter(roomId: string) {
    const routerPromise = routers.get(roomId)
    if (!routerPromise) {
        logger.error({ roomId }, 'Room not found');
        throw new AppError(`Room ${roomId} does not exist yet`, 404);
    }
    return routerPromise
}