/**
 * Phase 9 OnboardingPage — post-sign-in migration prompt.
 *
 * Runs exactly once per (device, user) pair. The `LoginPage` sends
 * users here after a successful sign-in if `isAlreadyMigrated(userId)`
 * is false. Three states:
 *
 *   • Empty device (no local games / no local events):
 *     skip the prompt, call `declineMigration(userId)` silently, and
 *     redirect to `next`.
 *
 *   • Device with anon data:
 *     show a summary ("N games, M weakness events") and two buttons —
 *     "Bring it with me" and "Start fresh". Either path results in
 *     `anon_claims` being recorded so this prompt never shows again.
 *
 *   • Unconfigured deployment or no session:
 *     bounce back to `/login`.
 *
 * The actual upload is done by `runMigration()` which posts to
 * `/api/migrate-anonymous`. Failures surface as an inline error; the
 * user can retry or skip.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';
import {
  declineMigration,
  runMigration,
  summarizeLocalForMigration,
  type MigrationSummary,
} from '../sync/migrateAnonymous';
import { hydrateFromRemote } from '../sync/syncOrchestrator';

type UiState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'prompt'; summary: MigrationSummary }
  | { kind: 'working' }
  | { kind: 'success'; games: number; events: number }
  | { kind: 'error'; message: string };

export default function OnboardingPage() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const nextParam = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.get('next') || '/';
  }, [location.search]);

  const [state, setState] = useState<UiState>({ kind: 'loading' });

  // Bounce unauthenticated / unconfigured visitors to /login.
  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated' || !user) {
      navigate('/login', { replace: true });
    }
  }, [status, user, navigate]);

  // Summarize local data once the session is stable.
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    let cancelled = false;
    void summarizeLocalForMigration().then((summary) => {
      if (cancelled) return;
      if (
        summary.localGameCount === 0 &&
        summary.localEventCount === 0 &&
        !summary.hasLocalProfile
      ) {
        // Nothing to migrate — mark claimed, pull whatever already
        // exists on the server for this user (fresh device scenario),
        // then continue to the requested landing page.
        setState({ kind: 'empty' });
        void (async () => {
          await declineMigration(user.id);
          await hydrateFromRemote(user.id);
          if (!cancelled) navigate(nextParam, { replace: true });
        })();
      } else {
        setState({ kind: 'prompt', summary });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, user, nextParam, navigate]);

  const onMigrate = async () => {
    if (!user) return;
    setState({ kind: 'working' });
    const result = await runMigration();
    if (!result.ok) {
      setState({
        kind: 'error',
        message: result.error ?? 'Migration failed — please retry.',
      });
      return;
    }
    // Local state matches what we just uploaded, but the user may
    // also have data from a previous device — pull it down before
    // redirecting.
    await hydrateFromRemote(user.id);
    setState({
      kind: 'success',
      games: result.counts.games,
      events: result.counts.weaknessEvents,
    });
    // Wait a beat so the user sees the confirmation, then redirect.
    setTimeout(() => navigate(nextParam, { replace: true }), 1500);
  };

  const onSkip = async () => {
    if (!user) return;
    setState({ kind: 'working' });
    await declineMigration(user.id);
    // Pull any existing remote data for this account (the user may
    // have played on another device already).
    await hydrateFromRemote(user.id);
    navigate(nextParam, { replace: true });
  };

  if (state.kind === 'loading' || state.kind === 'empty') {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-sm text-slate-400">Setting up your account…</p>
      </main>
    );
  }

  if (state.kind === 'success') {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <section className="w-full max-w-md rounded-lg border border-emerald-700/60 bg-emerald-900/20 p-6 text-center">
          <h1 className="text-xl font-bold text-emerald-100">
            Brought {state.games} game{state.games === 1 ? '' : 's'} and{' '}
            {state.events} weakness event{state.events === 1 ? '' : 's'} across.
          </h1>
          <p className="mt-2 text-sm text-emerald-200/80">
            Redirecting to your board…
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-6">
        <h1 className="text-xl font-bold text-slate-100">Welcome to Chesster</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          You've been playing anonymously on this device. Want to link those
          games and weakness stats to your new account?
        </p>

        {state.kind === 'prompt' && (
          <div className="mt-4 rounded border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
            <ul className="space-y-1">
              <li>
                <span className="font-mono text-slate-100">
                  {state.summary.localGameCount}
                </span>{' '}
                saved game{state.summary.localGameCount === 1 ? '' : 's'}
              </li>
              <li>
                <span className="font-mono text-slate-100">
                  {state.summary.localEventCount}
                </span>{' '}
                weakness event{state.summary.localEventCount === 1 ? '' : 's'}
              </li>
              <li className="text-xs text-slate-500">
                Device id:{' '}
                <span className="font-mono">
                  {state.summary.anonId.slice(0, 8)}…
                </span>
              </li>
            </ul>
          </div>
        )}

        {state.kind === 'error' && (
          <div
            role="alert"
            className="mt-4 rounded border border-rose-500/60 bg-rose-900/30 p-3 text-sm text-rose-100"
          >
            {state.message}
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={onMigrate}
            disabled={state.kind === 'working'}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state.kind === 'working' ? 'Migrating…' : 'Bring it with me'}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={state.kind === 'working'}
            className="text-sm text-slate-400 underline underline-offset-2 hover:text-slate-200 disabled:opacity-40"
          >
            Start fresh
          </button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          "Start fresh" keeps your local data untouched on this device but
          doesn't copy it to your account. You can always export games later
          from Settings.
        </p>
      </section>
    </main>
  );
}
