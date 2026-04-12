/**
 * Dashboard page — wraps the reusable `WeaknessDashboard` component
 * inside page chrome. The same component is also embeddable on the
 * Play page right rail (Phase 6) without needing the page title.
 */

import WeaknessDashboard from '../components/WeaknessDashboard';
import { useProfileStore } from '../profile/profileStore';

export default function DashboardPage() {
  const clearProfile = useProfileStore((s) => s.clearProfile);
  const hydrated = useProfileStore((s) => s.hydrated);
  const totalGames = useProfileStore((s) => s.profile.totalGames);

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-400">
            See where you stand — your strengths, weaknesses, and progress at a glance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm('Clear local profile? This cannot be undone.')) {
              clearProfile();
            }
          }}
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Clear profile
        </button>
      </header>

      {!hydrated ? (
        <p className="text-sm text-slate-500">Loading profile…</p>
      ) : totalGames === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
          No games yet. Play a game on the{' '}
          <span className="font-semibold text-slate-200">Play</span> tab to
          build your profile.
        </div>
      ) : (
        <WeaknessDashboard />
      )}
    </main>
  );
}
