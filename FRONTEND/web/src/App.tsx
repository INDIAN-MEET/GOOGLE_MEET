/**
 * src/App.tsx — the route table
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';

export default function App() {
  return (
    <Routes>
      {/* STEP 1 — public */}
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />

      {/* STEP 2 — private (needs login) */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:code" element={<RoomPage />} />
      </Route>

      {/* STEP 3 — anything else */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
