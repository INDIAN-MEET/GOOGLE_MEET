import type { Request, Response, NextFunction } from 'express';
import { getPeer, listProducers } from '../mediasoup/peerManager.ts';
import { createProducer, isValidKind, isValidSource } from '../mediasoup/producerManager.ts';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';

export async function produceHandler(req: Request, res: Response, next: NextFunction) {
    try {
        // STEP 1: userId is the new field
        const { roomId, peerId, transportId, kind, rtpParameters, source, userId  } = req.body ?? {};

        if (
            !roomId || !peerId || !transportId ||
            !isValidKind(kind) ||
            !userId ||
            !isValidSource(source) ||
            !rtpParameters || typeof rtpParameters !== 'object'
        ) {
            throw new AppError(
                'roomId, peerId, transportId, kind (audio|video), source (camera|mic|screen) and rtpParameters are required',
                400,
            );
        }

        const peer = getPeer(roomId, peerId);
        if (!peer) {
            throw new AppError('Peer not found. Create a transport first.', 404);
        }

        // STEP 2: only pass userId on when it is a string (Joi already checked it)
        const producer = await createProducer(
            peer,
            transportId,
            kind,
            rtpParameters,
            source,
            userId,
        );

        res.json({ success: true, data: { producerId: producer.id } });
    } catch (err) {
        if (!(err instanceof AppError)) {
            logger.error({ err }, 'Failed to produce');
        }
        next(err instanceof AppError ? err : new AppError('Failed to produce', 500));
    }
}
export function listProducersHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const roomId = String(req.params.roomId);
        const exceptPeerId =
            typeof req.query.exceptPeerId === 'string' ? req.query.exceptPeerId : undefined;

        const producers = listProducers(roomId, exceptPeerId);

        res.json({ success: true, data: producers });
    } catch (err) {
        if (!(err instanceof AppError)) {
            logger.error({ err }, 'Failed to list producers');
        }
        next(err instanceof AppError ? err : new AppError('Failed to list producers', 500));
    }
}