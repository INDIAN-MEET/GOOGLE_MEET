/**
 * src/call/CallSession.ts
 * -------------------------------------------------------------
 * Orchestrates ONE meeting: REST join → signaling → SFU → listeners.
 * Created inside a click handler (never in an effect) → StrictMode safe.
 *
 *   join()            enter the meeting
 *   leave()           exit cleanly
 *   sendChat()        live chat
 *   startScreenShare()/stopScreenShare()
 *   replaceVideoTrack()  camera flip
 */
import type { Socket } from 'socket.io-client';
import { getMessages } from '../api/chat';
import { getTurnCredentials } from '../api/auth';
import { joinRoom, leaveRoom } from '../api/rooms';
import { env } from '../config/env';
import { ApiError } from '../lib/apiClient';
import type { ChatMessage } from '../types/api';
import { useCallStore } from './callStore';
import { buildIceServers } from './iceServers';
import { createSocket, waitForConnect } from './signaling';
import { SFU_EVENTS, SfuClient, type ConsumedTrack, type RemoteProducerInfo } from './sfuClient';

interface MemberLike {
  userId?: string;
  id?: string;
  socketId?: string;
  displayName?: string;
  name?: string;
}

interface JoinedPayload {
  existingMembers?: Array<string | MemberLike>;
  mode?: string;
  recording?: { active?: boolean; recordingId?: string } | null;
}

const store = () => useCallStore.getState();

export class CallSession {
  private roomCode: string;
  private myUserId: string;
  private myDisplayName?: string;
  private signaling: Socket;
  private sfuSocket: Socket;
  private sfu: SfuClient;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  // Track socketId <-> userId
  private socketIdToUserId = new Map<string, string>();
  private remote = new Map<string, ConsumedTrack>(); // key = remote producerId
  private consuming = new Set<string>(); // producerIds already handled
  private pending: RemoteProducerInfo[] = []; // newProducer before we were ready
  private mediaReady = false;
  private rejoining = false;
  private left = false;

  constructor(roomCode: string, myUserId: string, myDisplayName?: string) {
    this.roomCode = roomCode;
    this.myUserId = myUserId;
    this.myDisplayName = myDisplayName;
    this.signaling = createSocket(env.signalingUrl);
    // if SFU events are relayed through signaling (A5) → share ONE socket
    this.sfuSocket = env.sfuUrl === env.signalingUrl ? this.signaling : createSocket(env.sfuUrl);
    this.sfu = new SfuClient(this.sfuSocket);
  }

  // ===================================================================
  // JOIN
  // ===================================================================
  async join(stream: MediaStream | null): Promise<void> {
    store().setPhase('joining');
    this.localStream = stream;
    store().setLocal(stream);

    try {
      // STEP 2 — REST join (409 = already a participant → fine)
      try {
        await joinRoom(this.roomCode);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
      }

      // STEP 3 — listeners FIRST, then connect
      this.bindListeners();
      this.signaling.connect();
      if (this.sfuSocket !== this.signaling) this.sfuSocket.connect();
      await Promise.all([waitForConnect(this.signaling), waitForConnect(this.sfuSocket)]);

      // STEP 4 — enter the signaling room (presence + who is here)
      await this.enterSignalingRoom();

      // STEP 5 — media (TURN → SFU → produce → consume existing)
      await this.startMedia();

      // STEP 6 — chat history (never fatal)
      getMessages(this.roomCode).then((h) => store().setMessages(h)).catch(() => {});

      store().setPhase('joined');
    } catch (e) {
      await this.teardown();
      store().setError(e instanceof Error ? e.message : 'Failed to join the meeting');
      throw e;
    }
  }

  private enterSignalingRoom(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Joining the room timed out')), 10_000);
      this.signaling.once('joined', (p: JoinedPayload) => {
        clearTimeout(timer);
        (p?.existingMembers ?? []).forEach((m) => {
          if (typeof m === 'string') {
            store().upsertPeer(m);
          } else {
            const uid = m.userId ?? m.id ?? m.socketId ?? '';
            const name = m.displayName ?? m.name;
            if (m.socketId && uid) this.socketIdToUserId.set(m.socketId, uid);
            store().upsertPeer(uid, name);
          }
        });
        if (p?.recording?.recordingId) {
          store().setRecording('recording', p.recording.recordingId);
        }
        resolve();
      });

      this.signaling.once('join-error', (msg: string) => {
        clearTimeout(timer);
        reject(new Error(msg || 'Failed to join room'));
      });

      this.signaling.emit('join-room', { roomCode: this.roomCode });
    });
  }

  private async startMedia(): Promise<void> {
    this.mediaReady = false;
    const creds = await getTurnCredentials().catch(() => null);
    await this.sfu.init(this.roomCode, buildIceServers(creds));

    const audio = this.localStream?.getAudioTracks().find((t) => t.readyState === 'live');
    const video = this.localStream?.getVideoTracks().find((t) => t.readyState === 'live');

    if (audio) {
      try {
        await this.sfu.produce(audio, 'mic');
      } catch (err) {
        console.warn('Failed to produce audio track:', err);
      }
    }

    if (video) {
      try {
        await this.sfu.produce(video, 'camera');
      } catch (err) {
        console.warn('Failed to produce video track:', err);
      }
    }

    const existing = await this.sfu.getProducers();
    await Promise.all(existing.map((p) => this.consumeOne(p)));

    this.mediaReady = true;
    const queued = this.pending.splice(0);
    await Promise.all(queued.map((p) => this.consumeOne(p)));
  }

  private resolveUserId(info: RemoteProducerInfo): string {
    const key = info.socketId || info.peerId || '';
    if (info.userId) return info.userId;
    if (key && this.socketIdToUserId.has(key)) return this.socketIdToUserId.get(key)!;
    return key || 'remote-peer';
  }

  private async consumeOne(info: RemoteProducerInfo): Promise<void> {
    const peerUserId = this.resolveUserId(info);
    if (peerUserId === this.myUserId || this.consuming.has(info.producerId)) return;
    this.consuming.add(info.producerId);
    try {
      const c = await this.sfu.consume(info, peerUserId);
      this.remote.set(info.producerId, c);
      store().upsertPeer(peerUserId);
      store().addTrack(peerUserId, c.source, c.track);
    } catch (e) {
      this.consuming.delete(info.producerId);
      console.warn('consume failed', info.producerId, e);
    }
  }

  // ===================================================================
  // LISTENERS (server → us)
  // ===================================================================
  private bindListeners(): void {
    const sig = this.signaling;

    // STEP 7 — presence
    sig.on('peer-joined', (m: { socketId: string; userId?: string; displayName?: string; name?: string }) => {
      const uid = m.userId ?? m.socketId;
      if (m.socketId && m.userId) this.socketIdToUserId.set(m.socketId, m.userId);
      store().upsertPeer(uid, m.displayName ?? m.name);
    });

    sig.on('peer-left', (m: { socketId: string; userId?: string }) => {
      const uid = m.userId ?? this.socketIdToUserId.get(m.socketId) ?? m.socketId;
      this.removePeer(uid, m.socketId);
    });

    // STEP 8 — chat
    sig.on('chat-message', (m: ChatMessage) => store().addMessage(m));

    // STEP 9 — recording events (Phase 10.9)
    sig.on('recording-started', (p?: { recordingId?: string }) => store().setRecording('recording', p?.recordingId));
    sig.on('recording-stopped', (p?: { recordingId?: string }) => store().setRecording('processing', p?.recordingId));
    sig.on('recording-ready', (p?: { recordingId?: string }) => store().setRecording('ready', p?.recordingId));
    sig.on('recording-failed', () => store().setRecording('failed'));

    // STEP 10 — host ended the meeting
    sig.on('room-ended', () => {
      store().setPhase('ended');
      void this.leave();
    });

    // STEP 11 — SFU notifications
    const onNewProducer = (info: RemoteProducerInfo) => {
      if (!this.mediaReady) this.pending.push(info);
      else void this.consumeOne(info);
    };

    const onProducerClosed = ({ producerId }: { producerId: string }) => {
      const c = this.remote.get(producerId);
      if (!c) return;
      this.sfu.dropConsumer(producerId);
      this.remote.delete(producerId);
      this.consuming.delete(producerId);
      store().removeTrack(c.userId, c.source, c.track);
    };

    this.sfuSocket.on(SFU_EVENTS.newProducer, onNewProducer);
    this.sfuSocket.on('newProducer', onNewProducer);

    this.sfuSocket.on(SFU_EVENTS.producerClosed, onProducerClosed);
    this.sfuSocket.on('producerClosed', onProducerClosed);

    // STEP 12 — connection health
    sig.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') store().setConnection('reconnecting');
    });
    [this.signaling, this.sfuSocket].forEach((s) => s.io.on('reconnect', () => void this.rejoin()));
  }

  private removePeer(userId: string, socketId?: string): void {
    for (const [producerId, c] of this.remote) {
      if (c.userId === userId || (socketId && c.socketId === socketId)) {
        this.sfu.dropConsumer(producerId);
        this.remote.delete(producerId);
        this.consuming.delete(producerId);
      }
    }
    store().removePeer(userId);
  }

  // ===================================================================
  // RECONNECT (server forgot us → rebuild everything)
  // ===================================================================
  private async rejoin(): Promise<void> {
    if (this.rejoining || this.left) return;
    this.rejoining = true;
    try {
      this.mediaReady = false;
      this.pending = [];
      this.remote.clear();
      this.consuming.clear();
      store().clearRemoteTracks();
      store().setSharing(false);
      this.screenStream?.getTracks().forEach((t) => t.stop());
      this.screenStream = null;

      this.sfu.close();
      this.sfu = new SfuClient(this.sfuSocket);
      await this.enterSignalingRoom();
      await this.startMedia();
      store().setConnection('connected');
    } catch {
      store().setError('Connection lost. Please leave and join again.');
    } finally {
      this.rejoining = false;
    }
  }

  // ===================================================================
  // ACTIONS (UI → us)
  // ===================================================================
  sendChat(text: string): void {
    this.signaling.emit('chat-message', {
      roomId: this.roomCode,
      text,
      senderName: this.myDisplayName || this.myUserId,
    });
  }

  async startScreenShare(): Promise<void> {
    const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = ds.getVideoTracks()[0];
    this.screenStream = ds;
    track.addEventListener('ended', () => void this.stopScreenShare());
    await this.sfu.produce(track, 'screen');
    store().setSharing(true);
  }

  async stopScreenShare(): Promise<void> {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    await this.sfu.closeProducer('screen');
    store().setSharing(false);
  }

  replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    return this.sfu.replaceVideoTrack(track);
  }

  // ===================================================================
  // LEAVE
  // ===================================================================
  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    try {
      this.signaling.emit('leave-room', { roomCode: this.roomCode });
    } catch {
      // socket may already be disconnected
    }
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.sfu.close();
    [this.signaling, this.sfuSocket].forEach((s) => {
      s.removeAllListeners();
      s.io.removeAllListeners();
      s.disconnect();
    });
    await leaveRoom(this.roomCode).catch(() => {});
  }
}

