/**
 * src/call/sfuClient.ts
 * -------------------------------------------------------------
 * Browser side of the mediasoup SFU (Phase 9).
 * Used by: CallSession.ts
 */
import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import type { Socket } from 'socket.io-client';
import { request } from './signaling';

// Exact event names matching services/signaling-service/src/handlers/sfu.ts
export const SFU_EVENTS = {
  // client → server (request/ack)
  getRtpCapabilities: 'get-router-capabilities',
  createTransport: 'create-transport',
  connectTransport: 'connect-transport',
  produce: 'produce',
  closeProducer: 'close-producer',
  getProducers: 'get-producers',
  consume: 'consume',
  resumeConsumer: 'resume-consumer',
  // server → client (notifications)
  newProducer: 'new-producer',
  producerClosed: 'producer-closed',
} as const;

export type Source = 'mic' | 'cam' | 'screen';
export interface RemoteProducerInfo {
  producerId: string;
  socketId?: string;
  peerId?: string;
  userId?: string;
  source: Source;
  kind?: 'audio' | 'video';
}
export interface ConsumedTrack extends RemoteProducerInfo {
  track: MediaStreamTrack;
  userId: string;
}

export class SfuClient {
  private socket: Socket;
  private device = new Device();
  private roomCode = '';
  private iceServers: RTCIceServer[] = [];
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private producers = new Map<Source, types.Producer>();
  private consumers = new Map<string, types.Consumer>(); // key = remote producerId
  onTransportState: ((state: string) => void) | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
  }

  // STEP 3 — load the device and create both pipes
  async init(roomCode: string, iceServers: RTCIceServer[]): Promise<void> {
    this.roomCode = roomCode;
    this.iceServers = iceServers;

    const res = await request<any>(
      this.socket,
      SFU_EVENTS.getRtpCapabilities,
      { roomCode },
    );
    const routerRtpCapabilities =
      res?.routerRtpCapabilities ?? res?.rtpCapabilities ?? res;
    if (!this.device.loaded) {
      await this.device.load({ routerRtpCapabilities });
    }

    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');
  }

  // STEP 4 — create ONE transport (server makes it, browser mirrors it)
  private async createTransport(direction: 'send' | 'recv'): Promise<types.Transport> {
    const params = await request<Record<string, unknown>>(
      this.socket,
      SFU_EVENTS.createTransport,
      { roomCode: this.roomCode, direction },
    );
    const options = { ...params, iceServers: this.iceServers } as unknown as types.TransportOptions;
    const transport =
      direction === 'send'
        ? this.device.createSendTransport(options)
        : this.device.createRecvTransport(options);

    // STEP 4a — first media use triggers 'connect': give the server our DTLS params
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      request(this.socket, SFU_EVENTS.connectTransport, {
        transportId: transport.id,
        dtlsParameters,
      })
        .then(() => callback()) // ← MUST be called or the call hangs
        .catch(errback);
    });

    // STEP 4b — send transport only: 'produce' → server creates producer, returns its id
    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        const source = (appData as { source?: Source })?.source ?? 'cam';
        request<{ producerId?: string; id?: string }>(this.socket, SFU_EVENTS.produce, {
          transportId: transport.id,
          kind,
          rtpParameters,
          source,
        })
          .then((res) => {
            const id = res?.producerId || res?.id;
            if (!id) throw new Error('Produce response missing producerId');
            callback({ id });
          })
          .catch(errback);
      });
    }

    transport.on('connectionstatechange', (state) => this.onTransportState?.(state));
    return transport;
  }

  // STEP 5 — publish one local track (mic / cam / screen)
  async produce(track: MediaStreamTrack, source: Source): Promise<void> {
    if (!this.sendTransport) throw new Error('SFU not initialised');
    const producer = await this.sendTransport.produce({
      track,
      appData: { source },
    });
    this.producers.set(source, producer);
  }

  // STEP 6 — stop publishing one source (e.g. stop screen share)
  async closeProducer(source: Source): Promise<void> {
    const p = this.producers.get(source);
    if (!p) return;
    p.close();
    this.producers.delete(source);
    await request(this.socket, SFU_EVENTS.closeProducer, { producerId: p.id }).catch(() => {});
  }

  // STEP 7 — camera flip: swap the track without renegotiating
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    await this.producers.get('cam')?.replaceTrack({ track });
  }

  // STEP 8 — who is already publishing in this room? (when we join late)
  async getProducers(): Promise<RemoteProducerInfo[]> {
    const res = await request<any>(
      this.socket,
      SFU_EVENTS.getProducers,
      { roomCode: this.roomCode },
    );
    const list = Array.isArray(res) ? res : res?.producers ?? [];
    return list.map((item: any) => ({
      producerId: item.producerId || item.id,
      socketId: item.peerId || item.socketId,
      peerId: item.peerId || item.socketId,
      userId: item.userId,
      source: item.source || (item.kind === 'audio' ? 'mic' : 'cam'),
      kind: item.kind,
    }));
  }

  // STEP 9 — receive one remote track
  async consume(info: RemoteProducerInfo, resolvedUserId: string): Promise<ConsumedTrack> {
    if (!this.recvTransport) throw new Error('SFU not initialised');
    const r = await request<{
      id: string;
      producerId: string;
      kind: 'audio' | 'video';
      rtpParameters: types.RtpParameters;
    }>(this.socket, SFU_EVENTS.consume, {
      transportId: this.recvTransport.id,
      producerId: info.producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    const consumer = await this.recvTransport.consume({
      id: r.id,
      producerId: r.producerId,
      kind: r.kind,
      rtpParameters: r.rtpParameters,
    });
    this.consumers.set(info.producerId, consumer);

    // consumers start paused on the server → resume, or video stays black
    await request(this.socket, SFU_EVENTS.resumeConsumer, { consumerId: consumer.id });
    return {
      ...info,
      userId: resolvedUserId,
      track: consumer.track,
    };
  }

  // STEP 10 — a remote producer went away
  dropConsumer(producerId: string): void {
    this.consumers.get(producerId)?.close();
    this.consumers.delete(producerId);
  }

  // STEP 11 — leave: close everything (closing transports closes their producers/consumers)
  close(): void {
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.producers.clear();
    this.consumers.clear();
    this.sendTransport = null;
    this.recvTransport = null;
  }
}

