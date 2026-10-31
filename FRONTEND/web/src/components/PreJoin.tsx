/**
 * src/components/PreJoin.tsx
 * -------------------------------------------------------------
 * "Green room": preview camera, toggle mic/cam, press Join.
 * The stream started HERE is passed into the call (no second getUserMedia).
 */
import { useEffect } from 'react';
import type { useLocalMedia } from '../media/useLocalMedia';
import { VideoTile } from './VideoTile';

interface Props {
  media: ReturnType<typeof useLocalMedia>;
  roomTitle?: string;
  joining: boolean;
  error: string | null;
  onJoin: () => void;
}

export function PreJoin({ media, roomTitle, joining, error, onJoin }: Props) {
  const { start } = media;

  // STEP 1 — open the camera preview when the screen appears
  useEffect(() => { void start(); }, [start]);

  return (
    <main className="center">
      <div className="card" style={{ width: 'min(560px, 100%)' }}>
        <h2 style={{ margin: 0 }}>{roomTitle ?? 'Ready to join?'}</h2>

        {/* STEP 2 — preview (muted + mirrored) */}
        <VideoTile stream={media.stream} name="You" muted mirror videoOff={!media.camOn} />

        {/* STEP 3 — toggles */}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className={`btn ${media.micOn ? '' : 'off'}`} onClick={media.toggleMic}>
            {media.micOn ? '🎤 Mic on' : '🔇 Mic off'}
          </button>
          <button className={`btn ${media.camOn ? '' : 'off'}`} onClick={media.toggleCam}>
            {media.camOn ? '📷 Camera on' : '🚫 Camera off'}
          </button>
        </div>

        {/* STEP 4 — errors (permission denied etc.) */}
        {media.error && <p className="error">{media.error}</p>}
        {error && <p className="error">{error}</p>}

        {/* STEP 5 — join (this click also satisfies browser autoplay rules) */}
        <button className="btn primary" disabled={joining} onClick={onJoin}>
          {joining ? 'Joining…' : 'Join now'}
        </button>
      </div>
    </main>
  );
}
