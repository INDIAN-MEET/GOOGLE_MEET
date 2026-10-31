/**
 * src/lib/tokenStore.ts
 * -------------------------------------------------------------
 * The ONLY file that knows where tokens are stored.
 *  - access token  → JS variable (lost on reload, re-created by refresh)
 *  - refresh token → localStorage (survives reload)
 */

const REFRESH_KEY = 'vm_refresh_token';

// STEP 1 — in-memory access token
let accessToken: string | null = null;

// STEP 2 — safe localStorage wrappers (private mode / blocked storage can throw)
function readRefresh(): string | null {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}
function writeRefresh(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch { /* storage blocked → user simply has to log in again after reload */ }
}

// STEP 3 — public API
export const tokenStore = {
  getAccess: () => accessToken,
  setAccess: (t: string | null) => { accessToken = t; },
  getRefresh: readRefresh,
  setRefresh: writeRefresh,
  clear() { accessToken = null; writeRefresh(null); },

  // STEP 4 — milliseconds until the JWT expires (decode only; server verifies)
  msUntilExpiry(): number {
    if (!accessToken) return 0;
    try {
      const payload = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const { exp } = JSON.parse(atob(payload)) as { exp?: number };
      return exp ? exp * 1000 - Date.now() : 0;
    } catch { return 0; }
  },
};
