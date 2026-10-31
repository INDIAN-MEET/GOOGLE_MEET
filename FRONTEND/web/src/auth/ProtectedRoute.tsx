/**
 * src/auth/ProtectedRoute.tsx
 * -------------------------------------------------------------
 * Wrap private pages. Used in App.tsx as a layout route.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  // STEP 1 — still restoring the session: show a spinner, do NOT redirect yet
  if (status === 'loading') return <div className="center">Loading…</div>;

  // STEP 2 — not logged in: go to /login and remember where we wanted to go
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // STEP 3 — logged in: render the child route
  return <Outlet />;
}

