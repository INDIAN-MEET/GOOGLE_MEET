/**
 * src/media/useLocalMedia.ts
 * -------------------------------------------------------------
 * Owns the user's camera + microphone MediaStream.
 * Used by: PreJoin (preview) and RoomPage/ControlsBar (during the call).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// STEP 1 — turn DOMException names into sentences users understand
function explain(e: unknown): string {
  if (!navigator.mediaDevices) {
    return 'Camera needs a secure page (https:// or localhost). See the HTTPS note in the guide.';
  }
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Camera/mic permission denied. Click the lock icon in the address bar and allow access.';
  if (name === 'NotFoundError') return 'No camera or microphone found.';
  if (name === 'NotReadableError') return 'Camera/mic is already in use by another app or tab.';
  return 'Could not access camera/microphone.';
}

export function useLocalMedia() {
  const streamRef = useRef<MediaStream | null>(null);
  const requestId = useRef(0); // protects against StrictMode double-start
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

  // STEP 2 — stop everything (releases camera light)
  const stop = useCallback(() => {
    requestId.current++; // invalidate any pending start()
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // STEP 3 — start camera + mic
  const start = useCallback(async () => {
    const myId = ++requestId.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (myId !== requestId.current) { s.getTracks().forEach((t) => t.stop()); return null; }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = s;
      setStream(s); setError(null); setMicOn(true); setCamOn(true); setFacing('user');
      return s;
    } catch (e) {
      if (myId === requestId.current) setError(explain(e));
      return null;
    }
  }, []);

  // STEP 4 — toggles (instant: just enable/disable the track)
  const toggleMic = useCallback(() => {
    const next = !micOn;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCamOn(next);
  }, [camOn]);

  // STEP 5 — flip front/back camera (phones). Returns the NEW video track so
  //          the caller can swap it inside the SFU producer (replaceTrack).
  const flipCamera = useCallback(async (): Promise<MediaStreamTrack | null> => {
    const cur = streamRef.current;
    if (!cur) return null;
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next } });
      const track = vs.getVideoTracks()[0];
      cur.getVideoTracks().forEach((t) => { t.stop(); cur.removeTrack(t); });
      cur.addTrack(track);
      track.enabled = camOn;
      setFacing(next);
      return track;
    } catch (e) { setError(explain(e)); return null; }
  }, [facing, camOn]);

  // STEP 6 — release the camera when the component using this hook unmounts
  useEffect(() => stop, [stop]);

  return { stream, error, micOn, camOn, facing, start, stop, toggleMic, toggleCam, flipCamera };
}
