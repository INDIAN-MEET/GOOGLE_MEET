import type { Request, Response, NextFunction } from 'express';
import { getRouter } from '../mediasoup/roomManager.ts';
import { getOrCreatePeer, getPeer } from '../mediasoup/peerManager.ts';
import { createTransport, connectTransport } from '../mediasoup/transportManager.ts';
import type { TransportDirection } from '../mediasoup/transportManager.ts';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';


export async function createTransportHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, peerId, direction } = req.body as {
            roomId: string;
            peerId: string;
            direction: TransportDirection;
        };

        if (!roomId || !peerId || (direction !== 'send' && direction !== 'recv')) {
            logger.error({ roomId, peerId, direction }, 'roomId, peerId and a valid direction are required');
            throw new AppError('roomId, peerId and a valid direction are required', 400);
        }

        const router = await getRouter(roomId);
        const peer = getOrCreatePeer(roomId, peerId);
        const transport = await createTransport(router, peer, direction);
        

        res.json({
            success: true,
            data: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            },
        });

    } catch (err: any) {
        logger.error({ err }, 'Failed to create transport');
        next(err instanceof AppError ? err : new AppError('Failed to create transport', 500));
    }
}


export async function connectTransportHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, peerId, transportId, dtlsParameters } = req.body;

        if (!roomId || !peerId || !transportId || !dtlsParameters) {
            logger.error({ roomId, peerId, transportId, dtlsParameters }, 'roomId, peerId, transportId and dtlsParameters are required');
            throw new AppError('roomId, peerId, transportId and dtlsParameters are required', 400);
        }

        const peer = getPeer(roomId, peerId);

        if (!peer) {
            logger.error({ roomId, peerId }, 'Peer not found');
            throw new AppError('Peer not found. Create a transport first.', 404);
        }

        await connectTransport(peer, transportId, dtlsParameters);

        res.json({ success: true, data: { connected: true } });
    } catch (err: any) {
        logger.error({ err }, 'Failed to connect transport');
        next(err instanceof AppError ? err : new AppError('Failed to connect transport', 500));
    }
}