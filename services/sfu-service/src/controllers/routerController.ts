import type { Request, Response, NextFunction } from 'express';
import { getOrCreateRouter } from '../mediasoup/roomManager.ts';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';


export async function getRouterCapabilities(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    try {
        const roomId = String(req.params.roomId);
        const router = await getOrCreateRouter(roomId)
        
        logger.info({ roomId, routerId: router.id }, 'Router capabilities fetched');

        res.json({
            success: true,
            data: { routerRtpCapabilities: router.rtpCapabilities },
        });
    } catch (err) {
        logger.error({ err }, 'Failed to get Router capabilities');
        next(new AppError('Failed to get Router capabilities', 500));
    }
}