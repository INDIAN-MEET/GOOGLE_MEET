import * as mediasoup from 'mediasoup';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';
import type { Peer } from './peerManager.ts';
import { notifyProducersChanged } from '../recording/recordingManager.ts';

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

/**
 * createProducer(...)
 *
 * STEP 1: Find the send transport and check the rules (direction, source/kind).
 *
 * STEP 2: Create the producer. userId goes into appData for the recorder.
 *
 * STEP 3: Save it in the peer map and keep the map in sync on close.
 *
 * STEP 4 (NEW): Tell the recording manager that this peer's producers changed.
 *         It does nothing if the room is not being recorded.
 *         It waits 700 ms first, so camera + mic become ONE sync.
 *
 * STEP 5 (NEW): Same call when a producer closes (camera off, screen share
 *         stopped, transport closed). The manager then restarts or ends the segment.
 */
export async function createProducer(
    peer: Peer,
    transportId: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
    source: ProducerSource,
    userId?: string,
): Promise<mediasoup.types.Producer> {
    // STEP 1
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

    // STEP 2
    let producer: mediasoup.types.Producer;

    try {
        producer = await transport.produce({
            kind,
            rtpParameters,
            appData: { peerId: peer.id, source, userId },
        });
    } catch (err: any) {
        logger.error({ err, peerId: peer.id, transportId }, 'transport.produce failed');
        throw new AppError('Failed to create producer (invalid rtpParameters?)', 400);
    }

    // STEP 3
    peer.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
        logger.info({ peerId: peer.id, producerId: producer.id }, 'Producer transport closed');
    });


    producer.observer.on('close', () => {
        peer.producers.delete(producer.id);
        logger.info({ peerId: peer.id, producerId: producer.id, source }, 'Producer closed');
        notifyProducersChanged(peer.roomId, peer.id);                 // STEP 5
    });

    logger.info(
        { peerId: peer.id, roomId: peer.roomId, producerId: producer.id, kind, source, userId },
        'Producer created',
    );

    notifyProducersChanged(peer.roomId, peer.id);                     // STEP 4

    return producer;
}