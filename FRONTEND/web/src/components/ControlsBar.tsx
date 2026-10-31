/**
 * src/components/ControlsBar.tsx
 * -------------------------------------------------------------
 * Bottom bar. Talks to: useLocalMedia (mic/cam) and CallSession (share/flip).
 */
import type { CallSession } from '../call/CallSession';
import { useCallStore } from '../call/callStore';
import type { useLocalMedia } from '../media/useLocalMedia';

export type Panel = 'chat' | 'recording' | 'invite' | null;

interface Props {
  media: ReturnType<typeof useLocalMedia>;
  session: CallSession | null;
  isHost: boolean;
  panel: Panel;
  onPanel: (p: Panel) => void;
  onLeave: () => void;
  onEnd: () => void;
}

export function ControlsBar({ media, session, isHost, panel, onPanel, onLeave, onEnd }: Props) {
  const sharing = useCallStore((s) => s.sharing);
  const recording = useCallStore((s) => s.recording.state);

  // STEP 1 — capability checks (phones cannot share their screen)
  const canShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const toggle = (p: Exclude<Panel, null>) => onPanel(panel === p ? null : p);

  // STEP 2 — actions
  async function onFlip() {
    const track = await media.flipCamera();
    if (track) await session?.replaceVideoTrack(track); // swap inside the SFU producer
  }

  async function onShare() {
    try {
      if (sharing) await session?.stopScreenShare();
      else await session?.startScreenShare();
    } catch {
      /* user cancelled the picker */
    }
  }

  return (
    <div className="controls">
      <button
        className={`btn ${media.micOn ? '' : 'off'}`}
        onClick={media.toggleMic}
        title={media.micOn ? 'Mute microphone' : 'Unmute microphone'}
      >
        {media.micOn ? '🎤' : '🔇'}
      </button>

      <button
        className={`btn ${media.camOn ? '' : 'off'}`}
        onClick={media.toggleCam}
        title={media.camOn ? 'Turn camera off' : 'Turn camera on'}
      >
        {media.camOn ? '📷' : '🚫'}
      </button>

      {isTouch && (
        <button className="btn" onClick={() => void onFlip()} title="Flip camera">
          🔄
        </button>
      )}

      {canShare && (
        <button
          className={`btn ${sharing ? 'primary' : ''}`}
          onClick={() => void onShare()}
          title={sharing ? 'Stop screen sharing' : 'Share screen'}
        >
          🖥️
        </button>
      )}

      <button
        className={`btn ${panel === 'chat' ? 'primary' : ''}`}
        onClick={() => toggle('chat')}
        title="Chat"
      >
        💬
      </button>

      <button
        className={`btn ${panel === 'recording' ? 'primary' : ''}`}
        onClick={() => toggle('recording')}
        title="Recordings"
      >
        {recording === 'recording' ? '🔴' : '⏺️'}
      </button>

      {isHost && (
        <button
          className={`btn ${panel === 'invite' ? 'primary' : ''}`}
          onClick={() => toggle('invite')}
          title="Invite guests"
        >
          ✉️
        </button>
      )}

      <button className="btn danger" onClick={onLeave} title="Leave meeting">
        Leave
      </button>

      {isHost && (
        <button className="btn danger" onClick={onEnd} title="End meeting for all">
          End for all
        </button>
      )}
    </div>
  );
}

