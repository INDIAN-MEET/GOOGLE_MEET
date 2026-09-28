import type { Request, Response, NextFunction } from 'express';
import { getRouter } from '../mediasoup/roomManager.ts';
import { getPeer } from '../mediasoup/peerManager.ts';
import { createConsumer, resumeConsumer } from '../mediasoup/consumerManager.ts';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

export async function consumeHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, peerId, producerId, rtpCapabilities } = req.body ?? {};

        if (
            !roomId || !peerId || !producerId ||
            !rtpCapabilities || typeof rtpCapabilities !== 'object'
        ) {
            throw new AppError('roomId, peerId, producerId and rtpCapabilities are required', 400);
        }

        const router = await getRouter(roomId);
        const peer = getPeer(roomId, peerId);

        if (!peer) {
            throw new AppError('Peer not found. Create a transport first.', 404);
        }

        const { consumer, producerPeerId, source } = await createConsumer(
            router,
            peer,
            producerId,
            rtpCapabilities,
        );

        res.json({
            success: true,
            data: {
                id: consumer.id,
                producerId: consumer.producerId,
                peerId: producerPeerId,
                kind: consumer.kind,
                source,
                rtpParameters: consumer.rtpParameters,
            },
        });
    } catch (err) {
        logger.error({ err }, 'Failed to consume');
        next(err instanceof AppError ? err : new AppError('Failed to consume', 500));
    }
}

export async function resumeConsumerHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, peerId, consumerId } = req.body ?? {};

        if (!roomId || !peerId || !consumerId) {
            throw new AppError('roomId, peerId and consumerId are required', 400);
        }

        const peer = getPeer(roomId, peerId);

        if (!peer) {
            throw new AppError('Peer not found', 404);
        }

        await resumeConsumer(peer, consumerId);

        res.json({ success: true, data: { resumed: true } });
    } catch (err) {
        logger.error({ err }, 'Failed to resume consumer');
        next(err instanceof AppError ? err : new AppError('Failed to resume consumer', 500));
    }
}