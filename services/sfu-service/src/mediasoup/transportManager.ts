import * as mediasoup from 'mediasoup';
import { mediasoupConfig } from '../config/mediasoup.ts';
import { logger } from '../utils/logger.ts';
import AppError from '../utils/AppError.ts';
import type { Peer } from './peerManager.ts';


export type TransportDirection = 'send' | 'recv';


export async function createTransport(router: mediasoup.types.Router, peer: Peer, direction: TransportDirection): Promise<mediasoup.types.WebRtcTransport> {

    // Rule: one peer can only have 1 send transport and 1 recv transport
    const existing = [...peer.transports.values()].find(
        transport => transport.appData.direction === direction
    )

    if (existing) {
        logger.error({ peerId: peer.id, direction }, 'Peer already has a transport');
        throw new AppError(`Peer already has a ${direction} transport`, 409);
    }

    const transport = await router.createWebRtcTransport({
        ...mediasoupConfig.webRtcTransport,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        appData: { peerId: peer.id, direction },
    })

    // If the connection dies, close the transport so it's not left hanging
    transport.on('dtlsstatechange', (state) => {
        if (state === 'failed' || state === 'closed') {
            transport.close();
        }
    });

    // Keep our records in sync when mediasoup closes the transport internally
    transport.observer.on('close', () => {
        logger.info({ peerId: peer.id, direction }, 'Transport closed');
        peer.transports.delete(transport.id);
    });

    peer.transports.set(transport.id, transport)

    logger.info(
        { peerId: peer.id, roomId: peer.roomId, direction, transportId: transport.id },
        'Transport created',
    );

    return transport
}


export async function connectTransport(peer: Peer, transportId: string, dtlsParameters: mediasoup.types.DtlsParameters): Promise<void> {
    const transport = peer.transports.get(transportId)

    if (!transport) {
        logger.error({ peerId: peer.id, transportId }, 'Transport not found');
        throw new AppError('Transport not found', 404);
    }

    await transport.connect({ dtlsParameters }).catch(() => {
        throw new AppError('Transport already connected or connect failed', 409);
    });

    logger.info({ peerId: peer.id, transportId }, 'Transport connected');
}