/**
 * src/components/ChatPanel.tsx
 * -------------------------------------------------------------
 * Reads messages from the store, sends via CallSession.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CallSession } from '../call/CallSession';
import { useCallStore } from '../call/callStore';

interface Props {
  session: CallSession | null;
  myUserId: string | null;
  onClose: () => void;
}

export function ChatPanel({ session, myUserId, onClose }: Props) {
  const messages = useCallStore((s) => s.messages);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // STEP 1 — scroll to newest
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // STEP 2 — send (no local append: the broadcast returns it)
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = text.trim().slice(0, 2000);
    if (!clean) return;
    session?.sendChat(clean);
    setText('');
  }

  return (
    <aside className="panel">
      <h3 className="row" style={{ justifyContent: 'space-between' }}>
        Chat <button className="btn" onClick={onClose}>✕</button>
      </h3>

      {/* STEP 3 — messages (React escapes text → safe from XSS) */}
      <div className="list">
        {messages.length === 0 && <p className="muted">No messages yet.</p>}
        {messages.map((m, i) => (
          <div className="msg" key={m.id ?? `${m.senderId}-${m.createdAt ?? i}-${i}`}>
            <b>{m.senderId === myUserId ? 'You' : m.senderName ?? m.senderId.slice(0, 6)}</b>
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* STEP 4 — composer */}
      <form className="composer" onSubmit={onSubmit}>
        <input
          value={text}
          maxLength={2000}
          placeholder="Send a message"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary">Send</button>
      </form>
    </aside>
  );
}

