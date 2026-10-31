/**
 * src/call/callStore.ts
 * -------------------------------------------------------------
 * zustand store = "what is true right now" in the call.
 * Written by: CallSession.ts     Read by: all call components
 */
import { create } from 'zustand';
import type { ChatMessage } from '../types/api';

// STEP 1 — types
export type Phase = 'idle' | 'joining' | 'joined' | 'ended' | 'error';
export type RecState = 'idle' | 'recording' | 'processing' | 'ready' | 'failed';
export interface Peer {
  userId: string;
  name?: string;
  cam: MediaStream | null;     // mic + camera tracks
  screen: MediaStream | null;  // screen-share track
}

interface CallState {
  phase: Phase;
  error: string | null;
  connection: 'connected' | 'reconnecting';
  local: MediaStream | null;
  sharing: boolean;
  peers: Record<string, Peer>;
  messages: ChatMessage[];
  recording: { state: RecState; recordingId?: string };

  setPhase: (p: Phase) => void;
  setError: (message: string | null) => void;
  setConnection: (c: 'connected' | 'reconnecting') => void;
  setLocal: (s: MediaStream | null) => void;
  setSharing: (v: boolean) => void;
  upsertPeer: (userId: string, name?: string) => void;
  removePeer: (userId: string) => void;
  addTrack: (userId: string, source: string, track: MediaStreamTrack) => void;
  removeTrack: (userId: string, source: string, track: MediaStreamTrack) => void;
  clearRemoteTracks: () => void;
  addMessage: (m: ChatMessage) => void;
  setMessages: (history: ChatMessage[]) => void;
  setRecording: (state: RecState, recordingId?: string) => void;
  reset: () => void;
}

// STEP 2 — initial values (also used by reset())
const initial = {
  phase: 'idle' as Phase,
  error: null as string | null,
  connection: 'connected' as const,
  local: null as MediaStream | null,
  sharing: false,
  peers: {} as Record<string, Peer>,
  messages: [] as ChatMessage[],
  recording: { state: 'idle' as RecState },
};

// mic + cam share one stream; screen has its own
const keyFor = (source: string): 'cam' | 'screen' => (source === 'screen' ? 'screen' : 'cam');

export const useCallStore = create<CallState>((set) => ({
  ...initial,

  // STEP 3 — simple setters
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error, phase: error ? 'error' : 'idle' }),
  setConnection: (connection) => set({ connection }),
  setLocal: (local) => set({ local }),
  setSharing: (sharing) => set({ sharing }),
  setRecording: (state, recordingId) => set({ recording: { state, recordingId } }),

  // STEP 4 — peers
  upsertPeer: (userId, name) =>
    set((s) => {
      if (!userId) return s;
      const old = s.peers[userId] ?? { userId, cam: null, screen: null };
      return { peers: { ...s.peers, [userId]: { ...old, name: name ?? old.name } } };
    }),
  removePeer: (userId) =>
    set((s) => {
      const { [userId]: _gone, ...rest } = s.peers;
      return { peers: rest };
    }),

  // STEP 5 — tracks: always build a NEW MediaStream so React re-renders
  addTrack: (userId, source, track) =>
    set((s) => {
      if (!userId) return s;
      const peer = s.peers[userId] ?? { userId, cam: null, screen: null };
      const key = keyFor(source);
      const existingTracks = peer[key]?.getTracks() ?? [];
      // avoid duplicate track addition
      if (existingTracks.includes(track)) return s;
      const next = new MediaStream([...existingTracks, track]);
      return { peers: { ...s.peers, [userId]: { ...peer, [key]: next } } };
    }),
  removeTrack: (userId, source, track) =>
    set((s) => {
      const peer = s.peers[userId];
      const key = keyFor(source);
      const prev = peer?.[key];
      if (!peer || !prev) return s;
      const rest = prev.getTracks().filter((t) => t !== track);
      return { peers: { ...s.peers, [userId]: { ...peer, [key]: rest.length ? new MediaStream(rest) : null } } };
    }),
  clearRemoteTracks: () =>
    set((s) => ({
      peers: Object.fromEntries(
        Object.entries(s.peers).map(([id, p]) => [id, { ...p, cam: null, screen: null }]),
      ),
    })),

  // STEP 6 — chat (de-duplicate by id when the server provides one)
  addMessage: (m) =>
    set((s) => (m.id && s.messages.some((x) => x.id === m.id) ? s : { messages: [...s.messages, m] })),
  setMessages: (history) =>
    set((s) => {
      const ids = new Set(history.map((m) => m.id).filter(Boolean));
      const live = s.messages.filter((m) => !m.id || !ids.has(m.id));
      const sorted = [...history].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      return { messages: [...sorted, ...live] };
    }),

  reset: () => set({ ...initial }),
}));

