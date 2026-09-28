import * as mediasoup from 'mediasoup';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';
import { findProducer } from './peerManager.ts';
import type { Peer } from './peerManager.ts';
import { findTransportByDirection } from './transportManager.ts';

// In-flight guard: 2 parallel requests same producer ke liye duplicate consumer na banayein
const pending = new Set<string>();

export interface CreatedConsumer {
    consumer: mediasoup.types.Consumer;
    producerPeerId: string;
    source: string;
}

export async function createConsumer(
    router: mediasoup.types.Router,
    peer: Peer,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities,
): Promise<CreatedConsumer> {
    const found = findProducer(peer.roomId, producerId);

    if (!found) {
        throw new AppError('Producer not found', 404);
    }

    if (found.peer.id === peer.id) {
        throw new AppError('Cannot consume your own producer', 400);
    }

    if (!router.canConsume({ producerId, rtpCapabilities })) {
        logger.error({ peerId: peer.id, producerId }, 'Router cannot consume (codec mismatch)');
        throw new AppError('Cannot consume: incompatible rtpCapabilities', 400);
    }

    const recvTransport = findTransportByDirection(peer, 'recv');

    if (!recvTransport) {
        throw new AppError('Peer has no recv transport. Create one first.', 400);
    }

    const key = `${peer.roomId}:${peer.id}:${producerId}`;
    const alreadyConsuming = [...peer.consumers.values()].some(
        (c) => c.producerId === producerId,
    );

    if (alreadyConsuming || pending.has(key)) {
        throw new AppError('Already consuming this producer', 409);
    }

    pending.add(key);

    try {
        const source = String(found.producer.appData.source ?? 'unknown');
        let consumer: mediasoup.types.Consumer;

        try {
            consumer = await recvTransport.consume({
                producerId,
                rtpCapabilities,
                paused: true, // resume tab hoga jab browser ready ho
                appData: { peerId: peer.id, producerPeerId: found.peer.id, source },
            });
        } catch (err) {
            logger.error({ err, peerId: peer.id, producerId }, 'transport.consume failed');
            throw new AppError('Failed to create consumer (invalid rtpCapabilities?)', 400);
        }

        peer.consumers.set(consumer.id, consumer);

        // Producer ya transport band hua: mediasoup consumer khud close karta hai. Log only.
        consumer.on('producerclose', () => {
            logger.info({ peerId: peer.id, consumerId: consumer.id }, 'Consumer producer closed');
        });
        consumer.on('transportclose', () => {
            logger.info({ peerId: peer.id, consumerId: consumer.id }, 'Consumer transport closed');
        });

        // Ek jagah jo map ko sync rakhti hai
        consumer.observer.on('close', () => {
            peer.consumers.delete(consumer.id);
            logger.info({ peerId: peer.id, consumerId: consumer.id }, 'Consumer closed');
        });

        logger.info(
            { peerId: peer.id, roomId: peer.roomId, consumerId: consumer.id, producerId, source },
            'Consumer created (paused)',
        );

        return { consumer, producerPeerId: found.peer.id, source };
    } finally {
        pending.delete(key);
    }
}

export async function resumeConsumer(peer: Peer, consumerId: string): Promise<void> {
    const consumer = peer.consumers.get(consumerId);

    if (!consumer) {
        logger.error({ peerId: peer.id, consumerId }, 'Consumer not found');
        throw new AppError('Consumer not found', 404);
    }

    await consumer.resume();
    logger.info({ peerId: peer.id, consumerId }, 'Consumer resumed');
}