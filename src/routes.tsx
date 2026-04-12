/**
 * Phase 10 route table.
 *
 * Single source of truth for the app's URL map. `NavShell` wraps
 * every page; `HomePage` is the index route, `PlayPage` owns `/play`,
 * and user-journey pages (Library, Profile, Settings) hang off their
 * own URLs.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import NavShell from './components/NavShell';
import HomePage from './pages/HomePage';
import PlayPage from './pages/PlayPage';
import DashboardPage from './pages/DashboardPage';
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
        <Route index element={<HomePage />} />
        <Route path="play" element={<PlayPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="mistakes" element={<MistakesPage />} />
        <Route path="practice" element={<PracticePage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="library/:gameId" element={<GameReviewPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
