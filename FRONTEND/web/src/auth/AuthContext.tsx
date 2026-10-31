/**
 * src/auth/AuthContext.tsx
 * -------------------------------------------------------------
 * Single source of truth for "who is logged in".
 * Talks to: src/api/auth.ts, src/lib/tokenStore.ts, src/lib/apiClient.ts
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import { setSessionExpiredHandler } from '../lib/apiClient';
import { tokenStore } from '../lib/tokenStore';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthValue {
  status: Status;
  userId: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // STEP 1 — state
  const [status, setStatus] = useState<Status>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  // STEP 2 — after tokens are stored, ask the server who we are
  const loadMe = useCallback(async () => {
    const me = await authApi.getMe();
    setUserId(me.userId);
    setStatus('authenticated');
  }, []);

  // STEP 3 — on first load: try to restore a session (interceptor refreshes if needed)
  useEffect(() => {
    if (!tokenStore.getRefresh() && !tokenStore.getAccess()) {
      setStatus('anonymous');
      return;
    }
    loadMe().catch(() => {
      tokenStore.clear();
      setStatus('anonymous');
    });
  }, [loadMe]);

  // STEP 4 — if a refresh fails anywhere later, drop to anonymous
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUserId(null);
      setStatus('anonymous');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  // STEP 5 — actions
  const login = useCallback(async (email: string, password: string) => {
    const t = await authApi.login(email, password);
    tokenStore.setAccess(t.accessToken);
    if (t.refreshToken) tokenStore.setRefresh(t.refreshToken);
    await loadMe();
  }, [loadMe]);

  const signup = useCallback(async (email: string, password: string) => {
    await authApi.signup(email, password);
    await login(email, password); // auto-login after signup
  }, [login]);

  const logout = useCallback(async () => {
    await authApi.logout();
    tokenStore.clear();
    setUserId(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ status, userId, login, signup, logout }),
    [status, userId, login, signup, logout],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// STEP 6 — hook for components
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
