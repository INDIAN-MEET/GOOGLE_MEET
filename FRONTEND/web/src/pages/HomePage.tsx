/**
 * src/pages/HomePage.tsx
 * -------------------------------------------------------------
 * New meeting (→ room-service) or join with a code/link.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../api/rooms';
import { useAuth } from '../auth/AuthContext';

// STEP 1 — accept either "abc-123" or a full link and return just the code
function extractCode(input: string): string {
  const trimmed = input.trim().split('?')[0].replace(/\/$/, '');
  return trimmed.split('/').pop() ?? '';
}

export default function HomePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState(''); // from <input type="datetime-local">
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // STEP 2 — create room, then open it
  async function onCreate() {
    setError(null); setBusy(true);
    try {
      const iso = scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
      const room = await createRoom(title || 'Untitled meeting', iso);
      navigate(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the meeting');
    } finally { setBusy(false); }
  }

  // STEP 3 — join by code/link
  function onJoin() {
    const code = extractCode(joinInput);
    if (code) navigate(`/room/${code}`);
  }

  return (
    <main className="center">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>Video Meet</h1>
          <button className="btn" onClick={() => void logout()}>Sign out</button>
        </div>

        <input placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="muted">Schedule (optional — enables email reminders)
          <input type="datetime-local" value={scheduledAt} style={{ width: '100%' }}
                 onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy} onClick={() => void onCreate()}>
          {busy ? 'Creating…' : 'New meeting'}
        </button>

        <hr style={{ borderColor: 'var(--line)', width: '100%' }} />

        <div className="row">
          <input style={{ flex: 1 }} placeholder="Enter code or link" value={joinInput}
                 onChange={(e) => setJoinInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && onJoin()} />
          <button className="btn" onClick={onJoin} disabled={!joinInput.trim()}>Join</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}

