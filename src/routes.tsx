/**
 * Phase 5 route table.
 *
 * Single source of truth for the app's URL map. Kept tiny and
 * JSX-based so it reads top-to-bottom: `NavShell` wraps every page,
 * `PlayPage` is the index route, and `DashboardPage` / `MistakesPage`
 * hang off their own URLs. Future pages (Library, Practice,
 * Settings) slot in as additional `<Route>` siblings.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import NavShell from './components/NavShell';
import PlayPage from './pages/PlayPage';
import DashboardPage from './pages/DashboardPage';
import MistakesPage from './pages/MistakesPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<NavShell />}>
        <Route index element={<PlayPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="mistakes" element={<MistakesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/*
          Phase 9 auth routes. Rendered INSIDE NavShell so the header
          stays consistent across the sign-in flow — pages themselves
          render an empty main with their own card.
        */}
        <Route path="login" element={<LoginPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
