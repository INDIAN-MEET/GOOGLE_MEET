/**
 * src/components/VideoTile.tsx
 * -------------------------------------------------------------
 * One video box. Works for local preview AND remote peers.
 */
import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  name?: string;
  muted?: boolean;   // true for OUR OWN tile (avoid echo)
  mirror?: boolean;  // true for OUR OWN camera
  videoOff?: boolean;
}

export function VideoTile({ stream, name, muted = false, mirror = false, videoOff = false }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  // STEP 1 — attach the MediaStream to the <video> element
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  // STEP 2 — show a letter avatar when there is no live video
  const noVideo = videoOff || !stream || stream.getVideoTracks().length === 0;

  return (
    <div className={`tile ${mirror ? 'mirror' : ''}`}>
      {/* playsInline = required for iOS; autoPlay works because joining was a user click */}
      <video ref={ref} autoPlay playsInline muted={muted} />
      {noVideo && <div className="placeholder">{(name ?? '?').slice(0, 1).toUpperCase()}</div>}
      {name && <span className="name">{name}</span>}
    </div>
  );
}
