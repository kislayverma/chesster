/**
 * React hook that tracks page-views on every React Router navigation.
 * Mount once near the top of the component tree (inside <BrowserRouter>).
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from './analytics';

export function usePageTracking(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
}
