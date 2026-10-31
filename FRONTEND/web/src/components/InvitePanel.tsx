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
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const inviteUrl = `${window.location.origin}/room/${roomCode}`;

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      /* clipboard API fallback */
    }
  }

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
        text: `Sent ${valid.length} invite(s). In local Docker, view emails in Mailpit at http://localhost:8025.${
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
        Invite Guests <button className="btn" onClick={onClose}>✕</button>
      </h3>
      <div className="list">
        {/* Instant Share Link */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
            Direct Meeting Link
          </label>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="text"
              readOnly
              value={inviteUrl}
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 13,
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--line)',
                borderRadius: 6,
              }}
            />
            <button className="btn" onClick={() => void onCopyLink()} title="Copy link">
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
        </div>

        <hr style={{ borderColor: 'var(--line)', margin: '8px 0 12px 0' }} />

        {/* Email Invites */}
        <label style={{ fontSize: 13, fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
          Or invite via email
        </label>
        <textarea
          rows={4}
          placeholder="alice@example.com, bob@example.com"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          style={{
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 10,
            fontSize: 14,
            resize: 'vertical',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        {msg && <p className={msg.ok ? 'muted' : 'error'} style={{ color: msg.ok ? '#0F9D58' : undefined }}>{msg.text}</p>}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          <span>Local development: Incoming emails are collected in </span>
          <a href="http://localhost:8025" target="_blank" rel="noreferrer" style={{ color: '#1A73E8' }}>
            Mailpit Web Inbox (:8025)
          </a>
        </div>
      </div>
      <div className="composer">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void onSend()}
          style={{ flex: 1 }}
        >
          {busy ? 'Sending…' : 'Send email invites'}
        </button>
      </div>
    </aside>
  );
}

