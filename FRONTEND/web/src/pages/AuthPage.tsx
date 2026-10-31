/**
 * src/pages/AuthPage.tsx
 * -------------------------------------------------------------
 * One form for /login and /signup (prop `mode` switches the labels).
 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/apiClient';

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // where to go after success (set by ProtectedRoute), default home
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  // STEP 1 — local form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // STEP 2 — submit
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      // STEP 3 — friendly messages (429 shows the countdown from Retry-After)
      if (err instanceof ApiError && err.status === 429 && err.retryAfter) {
        setError(`Too many attempts. Try again in ${err.retryAfter}s.`);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card" onSubmit={onSubmit}>
        <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          required
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={password}
          required
          minLength={8}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>
        <p className="muted">
          {mode === 'login' ? (
            <>
              No account? <Link to="/signup">Sign up</Link>
            </>
          ) : (
            <>
              Have an account? <Link to="/login">Sign in</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}

