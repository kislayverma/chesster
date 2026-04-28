/**
 * Phase 10 route table.
 *
 * Single source of truth for the app's URL map. `NavShell` wraps
 * every page; `HomePage` is the index route, `PlayPage` owns `/play`,
 * and user-journey pages (Library, Profile, Settings) hang off their
 * own URLs.
 *
 * Routes inside <RequireAuth> redirect anonymous users to /login.
 * The 'unconfigured' status (no Supabase keys) is allowed through
 * so local development works without an auth backend.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import NavShell from './components/NavShell';
import RequireAuth from './components/RequireAuth';
import HomePage from './pages/HomePage';
import PlayPage from './pages/PlayPage';
import MistakesPage from './pages/MistakesPage';
import PracticePage from './pages/PracticePage';
import LibraryPage from './pages/LibraryPage';
import GameReviewPage from './pages/GameReviewPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<NavShell />}>
        {/* Public routes */}
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />

        {/* Protected routes — anonymous users are redirected to /login */}
        <Route element={<RequireAuth />}>
          <Route path="play" element={<PlayPage />} />
          <Route path="mistakes" element={<MistakesPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="library/:gameId" element={<GameReviewPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
