/**
 * src/components/RecordingPanel.tsx
 * -------------------------------------------------------------
 * Talks to: recording-service (REST via Gateway) + store (socket events).
 */
import { useCallback, useEffect, useState } from 'react';
import { downloadRecording, listRecordings, startRecording, stopRecording } from '../api/recordings';
import { useCallStore } from '../call/callStore';
import type { Recording } from '../types/api';

interface Props {
  roomCode: string;
  isHost: boolean;
  onClose: () => void;
}

export function RecordingPanel({ roomCode, isHost, onClose }: Props) {
  const rec = useCallStore((s) => s.recording);
  const [items, setItems] = useState<Recording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  // STEP 1 — load the list
  const refresh = useCallback(async () => {
    try {
      setItems(await listRecordings(roomCode));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [roomCode]);

  // STEP 2 — load on open and whenever the live state changes (e.g. → ready)
  useEffect(() => {
    void refresh();
  }, [refresh, rec.state]);

  // STEP 3 — safety poll ONLY while something is processing
  const processing =
    rec.state === 'processing' ||
    items.some((r) => r.status === 'PROCESSING' || r.status === 'STOPPING');

  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [processing, refresh]);

  // STEP 4 — free the blob URL when it changes / unmounts
  useEffect(() => () => {
    if (playUrl) URL.revokeObjectURL(playUrl);
  }, [playUrl]);

  // STEP 5 — host actions
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onStart = () =>
    run(async () => {
      const r = await startRecording(roomCode);
      useCallStore.getState().setRecording('recording', r.id);
    });

  const onStop = () => run(() => stopRecording(roomCode));

  // STEP 6 — fetch the file as a Blob (the Authorization header can't be sent by <video src>)
  async function fetchBlobUrl(id: string) {
    const blob = await downloadRecording(id);
    return URL.createObjectURL(blob);
  }

  const onPlay = (id: string) =>
    run(async () => {
      setPlayUrl(await fetchBlobUrl(id));
    });

  const onDownload = (id: string) =>
    run(async () => {
      const url = await fetchBlobUrl(id);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${id}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  return (
    <aside className="panel">
      <h3 className="row" style={{ justifyContent: 'space-between' }}>
        Recordings <button className="btn" onClick={onClose}>✕</button>
      </h3>

      <div className="list">
        {/* STEP 7 — live status */}
        <p className="muted">
          Status:{' '}
          {rec.state === 'recording'
            ? '🔴 Recording'
            : rec.state === 'processing'
            ? '⏳ Processing…'
            : rec.state === 'ready'
            ? '✅ Ready'
            : rec.state === 'failed'
            ? '❌ Failed'
            : 'Not recording'}
        </p>

        {isHost && (
          rec.state === 'recording' ? (
            <button className="btn danger" disabled={busy} onClick={() => void onStop()}>
              ⏹ Stop recording
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void onStart()}>
              ⏺ Start recording
            </button>
          )
        )}
        {error && <p className="error">{error}</p>}

        {/* STEP 8 — list */}
        {items.map((r) => (
          <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">
              {r.status}
              {r.durationSec ? ` · ${r.durationSec}s` : ''}
            </span>
            {r.status === 'COMPLETED' && (
              <span className="row">
                <button className="btn" disabled={busy} onClick={() => void onPlay(r.id)} title="Play">
                  ▶
                </button>
                <button className="btn" disabled={busy} onClick={() => void onDownload(r.id)} title="Download">
                  ⬇
                </button>
              </span>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="muted">No recordings yet.</p>}

        {/* STEP 9 — player */}
        {playUrl && (
          <video
            src={playUrl}
            controls
            playsInline
            style={{ width: '100%', borderRadius: 8, marginTop: 8 }}
          />
        )}
      </div>
    </aside>
  );
}

