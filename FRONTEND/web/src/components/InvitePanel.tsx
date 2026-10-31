/**
 * src/components/InvitePanel.tsx
 * -------------------------------------------------------------
 * Host-only. Talks to: notification-service via src/api/notifications.ts
 */
import { useState } from 'react';
import { sendInvites } from '../api/notifications';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitePanel({ roomCode, onClose }: { roomCode: string; onClose: () => void }) {
  const [raw, setRaw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSend() {
    // STEP 1 — split → lowercase → validate → de-duplicate
    const all = raw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const valid = [...new Set(all.filter((e) => EMAIL_RE.test(e)))];
    const invalid = all.filter((e) => !EMAIL_RE.test(e));
    if (valid.length === 0) {
      setMsg({ ok: false, text: 'Enter at least one valid email.' });
      return;
    }

    // STEP 2 — send
    setBusy(true);
    setMsg(null);
    try {
      await sendInvites(roomCode, valid);
      setMsg({
        ok: true,
        text: `Sent ${valid.length} invite(s).${
          invalid.length ? ` Skipped invalid: ${invalid.join(', ')}` : ''
        }`,
      });
      setRaw('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel">
      <h3 className="row" style={{ justifyContent: 'space-between' }}>
        Invite by email <button className="btn" onClick={onClose}>✕</button>
      </h3>
      <div className="list">
        <textarea
          rows={6}
          placeholder="alice@example.com, bob@example.com"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          style={{
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 10,
            fontSize: 16,
            resize: 'vertical',
          }}
        />
        {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
        <p className="muted">Dev: read the emails in Mailpit → http://localhost:8025</p>
      </div>
      <div className="composer">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void onSend()}
          style={{ flex: 1 }}
        >
          {busy ? 'Sending…' : 'Send invites'}
        </button>
      </div>
    </aside>
  );
}
