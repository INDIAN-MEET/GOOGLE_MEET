import * as mediasoup from 'mediasoup'
import { logger } from '../utils/logger.ts';

export interface Peer {

    id: string;
    roomId: string;
    joinedAt: number;
    transports: Map<string, mediasoup.types.WebRtcTransport>;
    producers: Map<string, mediasoup.types.Producer>;
    consumers: Map<string, mediasoup.types.Consumer>;

}


// roomId -> (peerId -> Peer)
const rooms = new Map<string, Map<string, Peer>>();

export function getOrCreatePeer(roomId: string, peerId: string): Peer {
    let roomPeers = rooms.get(roomId)

    if (!roomPeers) {
        roomPeers = new Map()
        rooms.set(roomId, roomPeers)
    }

    let peer = roomPeers.get(peerId)

    if (!peer) {
        peer = {
            id: peerId,
            roomId,
            joinedAt: Date.now(),
            transports: new Map(),
            producers: new Map(),
            consumers: new Map(),
        };
        roomPeers.set(peerId, peer);
    }

    return peer;
}


export function getPeer(roomId: string, peerId: string): Peer | undefined {
    let peer = rooms.get(roomId)?.get(peerId)
    return peer
}


export function getPeerCount(roomId: string): number {
    let peerCount = rooms.get(roomId)?.size
    return peerCount ?? 0
}

/**
 * listPeerIds(roomId)
 *
 * STEP 1: Return the ids of all peers currently in the room.
 *         Empty array if the room does not exist.
 *         The recording manager uses it to start segments for peers
 *         who joined BEFORE the recording started.
 */
export function listPeerIds(roomId: string): string[] {
    return [...(rooms.get(roomId)?.keys() ?? [])];
}


export interface ProducerInfo {
    producerId: string;
    peerId: string;
    kind: mediasoup.types.MediaKind;
    source: string;
}

export function findProducer(roomId: string, producerId: string): { peer: Peer; producer: mediasoup.types.Producer } | undefined {
    const roomPeers = rooms.get(roomId);
    if (!roomPeers) return undefined;

    for (const peer of roomPeers.values()) {
        const producer = peer.producers.get(producerId);
        if (producer) return { peer, producer };
    }
    return undefined;
}


// All producers in a room, optionally excluding one peer (the asker)
export function listProducers(roomId: string, exceptPeerId?: string): ProducerInfo[] {
    const roomPeers = rooms.get(roomId)
    if (!roomPeers) return [];

    const result: ProducerInfo[] = []

    for (const peer of roomPeers.values()) {

        if (exceptPeerId && peer.id === exceptPeerId) continue;

        for (const producer of peer.producers.values()) {
            result.push({
                producerId: producer.id,
                peerId: peer.id,
                kind: producer.kind,
                source: String(producer.appData.source ?? 'unknown'),
            });
        }
    }

    return result
}

export interface RemovePeerResult {
    closedProducerIds: string[];
    peerExisted: boolean;
    roomEmpty: boolean;
}


/**
 * removePeer(roomId, peerId)
 *
 * STEP 1: Look up the room map and the peer inside it.
 *
 * STEP 2: If the room or the peer does not exist, return an empty result.
 *         This makes the function idempotent, because "disconnect" and
 *         "leave-room" can both arrive for the same peer.
 *
 * STEP 3: Collect the producer IDs BEFORE closing anything.
 *         After transport.close() the producers are gone and we cannot
 *         tell Signaling which ones to announce as closed.
 *
 * STEP 4: Delete the peer from the room map first.
 *         The transport 'close' observer also touches the maps, so the
 *         peer must already be out of the way.
 *
 * STEP 5: Close every transport of the peer.
 *         Mediasoup closes the producers and consumers of a transport
 *         automatically. We loop over a COPY of the values because the
 *         close observer mutates the original map during the loop.
 *
 * STEP 6: If the room map is now empty, delete it from `rooms`.
 *
 * STEP 7: Return the closed producer IDs and whether the room is empty.
 *         The controller uses roomEmpty to decide about closeRoom().
 *
 * @param {string} roomId - Room the peer belongs to.
 * @param {string} peerId - Peer (socket.id) that is leaving.
 * @returns {RemovePeerResult} IDs of closed producers + room state.
 */

export function removePeer(roomId: string, peerId: string): RemovePeerResult {
    // STEP 1
    const room = rooms.get(roomId)
    const peer = room?.get(peerId)

    // STEP 2

    if (!room || !peer) {
        return {
            closedProducerIds: [],
            peerExisted: false,
            roomEmpty: !room || room.size === 0,
        };
    }

    // STEP 3

    const closedProducerIds = [...peer.producers.keys()]

    // STEP 4
    room.delete(peerId);

    // STEP 5

    for (const transport of [...peer.transports.values()]) {
        try {
            transport.close()
        } catch (err: any) {
            logger.warn({ err, roomId, peerId }, 'Failed to close transport');
        }
    }

    // STEP 6
    const roomEmpty = room.size === 0;
    if (roomEmpty) rooms.delete(roomId);

    logger.info(
        { roomId, peerId, closedProducers: closedProducerIds.length },
        'Peer removed'
    );
    // STEP 7
    return { closedProducerIds, peerExisted: true, roomEmpty };
}