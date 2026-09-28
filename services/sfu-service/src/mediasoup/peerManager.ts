import * as mediasoup from 'mediasoup'

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