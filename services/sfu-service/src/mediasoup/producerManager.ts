import * as mediasoup from 'mediasoup';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';
import type { Peer } from './peerManager.ts';

export type ProducerSource = 'camera' | 'mic' | 'screen';

const SOURCE_KIND: Record<ProducerSource, mediasoup.types.MediaKind> = {
    camera: 'video',
    screen: 'video',
    mic: 'audio',
};

export function isValidSource(value: unknown): value is ProducerSource {
    return typeof value === 'string' && Object.hasOwn(SOURCE_KIND, value);
}

export function isValidKind(value: unknown): value is mediasoup.types.MediaKind {
    return value === 'audio' || value === 'video';
}

export async function createProducer(
    peer: Peer,
    transportId: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
    source: ProducerSource,
): Promise<mediasoup.types.Producer> {
    const transport = peer.transports.get(transportId);

    if (!transport) {
        logger.error({ peerId: peer.id, transportId }, 'Transport not found');
        throw new AppError('Transport not found', 404);
    }

    if (transport.appData.direction !== 'send') {
        logger.error({ peerId: peer.id, transportId }, 'Cannot produce on a non-send transport');
        throw new AppError('Can only produce on a send transport', 400);
    }

    if (SOURCE_KIND[source] !== kind) {
        throw new AppError(`Source "${source}" requires kind "${SOURCE_KIND[source]}"`, 400);
    }

    let producer: mediasoup.types.Producer;

    try {
        producer = await transport.produce({
            kind,
            rtpParameters,
            appData: { peerId: peer.id, source },
        });
    } catch (err: any) {
        logger.error({ err, peerId: peer.id, transportId }, 'transport.produce failed');
        throw new AppError('Failed to create producer (invalid rtpParameters?)', 400);
    }

    peer.producers.set(producer.id, producer);
    // Transport closed -> mediasoup closes the producer itself. Log only.
    producer.on('transportclose', () => {
        logger.info({ peerId: peer.id, producerId: producer.id }, 'Producer transport closed');
    });

    // Single place that keeps our map in sync
    producer.observer.on('close', () => {
        peer.producers.delete(producer.id);
        logger.info({ peerId: peer.id, producerId: producer.id, source }, 'Producer closed');
    });

    logger.info(
        { peerId: peer.id, roomId: peer.roomId, producerId: producer.id, kind, source },
        'Producer created',
    );

    return producer;
}