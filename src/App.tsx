/**
 * App root — Phase 5 is now just a router host. Page chrome lives in
 * `NavShell` and each view is its own module under `src/pages/`.
 */

import AppRoutes from './routes';
import { usePageTracking } from './lib/usePageTracking';

export default function App() {
  usePageTracking();
  return <AppRoutes />;
}
