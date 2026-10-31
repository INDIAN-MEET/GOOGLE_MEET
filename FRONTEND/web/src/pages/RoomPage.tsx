/**
 * src/pages/RoomPage.tsx
 * -------------------------------------------------------------
 * The meeting screen. Decides what to show and owns the CallSession.
 *   REST   → src/api/rooms.ts           (room info, end)
 *   LIVE   → src/call/CallSession.ts    (sockets + SFU)
 *   STATE  → src/call/callStore.ts      (what to draw)
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { endRoom, getRoom } from '../api/rooms';
import { useAuth } from '../auth/AuthContext';
import { CallSession } from '../call/CallSession';
import { useCallStore } from '../call/callStore';
import { ChatPanel } from '../components/ChatPanel';
import { ControlsBar, type Panel } from '../components/ControlsBar';
import { InvitePanel } from '../components/InvitePanel';
import { PreJoin } from '../components/PreJoin';
import { RecordingPanel } from '../components/RecordingPanel';
import { VideoGrid } from '../components/VideoGrid';
import { useLocalMedia } from '../media/useLocalMedia';
import type { RoomDetails } from '../types/api';

export default function RoomPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { userId } = useAuth();
  const media = useLocalMedia();

  // STEP 1 — state
  const sessionRef = useRef<CallSession | null>(null); // for cleanup
  const [session, setSession] = useState<CallSession | null>(null); // for rendering
  const [details, setDetails] = useState<RoomDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const phase = useCallStore((s) => s.phase);
  const joinError = useCallStore((s) => s.error);
  const connection = useCallStore((s) => s.connection);

  // STEP 2 — does this room exist? (also tells us who the host is)
  useEffect(() => {
    let cancelled = false;
    getRoom(code)
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // STEP 3 — safety net: leaving the page (Back button) leaves the meeting
  useEffect(() => () => {
    void sessionRef.current?.leave();
    useCallStore.getState().reset();
  }, []);

  // STEP 4 — host detection
  const isHost =
    !!details &&
    (details.room.hostId === userId ||
      !!details.participants?.some((p) => p.userId === userId && p.role === 'host'));

  // STEP 5 — click handlers (sessions are created ONLY here)
  async function onJoin() {
    if (!userId) return;
    let stream = media.stream;
    const hasLiveTracks = stream?.getTracks().some((t) => t.readyState === 'live');
    if (!hasLiveTracks) {
      const fresh = await media.start();
      if (fresh) stream = fresh;
    }
    const s = new CallSession(code, userId);
    sessionRef.current = s;
    setSession(s);
    try {
      await s.join(stream);
    } catch {
      /* message already in the store */
    }
  }

  async function onLeave() {
    await sessionRef.current?.leave();
    navigate('/');
  }

  async function onEnd() {
    if (!window.confirm('End the meeting for everyone?')) return;
    await endRoom(code).catch(() => {});
    await onLeave();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
    } catch {
      /* clipboard write failure in insecure contexts */
    }
  }

  // STEP 6 — which screen?
  if (loadError) {
    return (
      <main className="center">
        <div className="card">
          <p className="error">{loadError}</p>
          <Link to="/">Back home</Link>
        </div>
      </main>
    );
  }

  if (!details) return <div className="center">Loading room…</div>;

  if (phase === 'ended') {
    return (
      <main className="center">
        <div className="card">
          <h2>Meeting ended</h2>
          <Link to="/">Back home</Link>
        </div>
      </main>
    );
  }

  if (phase !== 'joined') {
    return (
      <PreJoin
        media={media}
        roomTitle={details.room.title}
        joining={phase === 'joining'}
        error={joinError}
        onJoin={() => void onJoin()}
      />
    );
  }

  // STEP 7 — the call screen
  return (
    <div className="call">
      <div>
        <div className="call-header">
          <span>
            <strong>{details.room.title ?? 'Meeting'}</strong>{' '}
            <span className="muted">· {code}</span>
          </span>
          <button className="btn" onClick={() => void copyLink()}>
            🔗 Copy link
          </button>
        </div>
        {connection === 'reconnecting' && <div className="banner">Reconnecting…</div>}
      </div>

      <div className={`call-body ${panel ? 'with-panel' : ''}`}>
        <VideoGrid camOn={media.camOn} />
        {panel === 'chat' && (
          <ChatPanel session={session} myUserId={userId} onClose={() => setPanel(null)} />
        )}
        {panel === 'recording' && (
          <RecordingPanel roomCode={code} isHost={isHost} onClose={() => setPanel(null)} />
        )}
        {panel === 'invite' && isHost && (
          <InvitePanel roomCode={code} onClose={() => setPanel(null)} />
        )}
      </div>

      <ControlsBar
        media={media}
        session={session}
        isHost={isHost}
        panel={panel}
        onPanel={setPanel}
        onLeave={() => void onLeave()}
        onEnd={() => void onEnd()}
      />
    </div>
  );
}
