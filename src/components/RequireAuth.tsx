/**
 * Route guard that redirects anonymous users to /login.
 *
 * Wrap protected <Route> elements with this component so that
 * unauthenticated visitors are sent to the login page instead
 * of seeing an empty or broken view.
 *
 * The 'unconfigured' status (no Supabase keys, e.g. local dev)
 * is treated as allowed so that local development continues to
 * work without an auth backend.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';

export default function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'loading') {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <span className="text-sm text-slate-400">Loading...</span>
      </main>
    );
  }

  // Allow authenticated users and unconfigured deployments (local dev).
  if (status === 'authenticated' || status === 'unconfigured') {
    return <Outlet />;
  }

  // Anonymous users are redirected to /login. The current path is
  // preserved as ?next= so LoginPage can redirect back after auth.
  return (
    <Navigate
      to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      replace
    />
  );
}
