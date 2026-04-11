/**
 * Phase 9 LoginPage — Supabase magic-link sign-in.
 *
 * Minimal flow:
 *
 *   1. User types their email and hits "Send link".
 *   2. `authStore.signInWithEmail(email, redirect)` kicks off a
 *      Supabase `signInWithOtp` request.
 *   3. On success we flip the form into a "check your inbox" state.
 *      The user clicks the emailed link and Supabase drops them back
 *      on `/login?...` with a session hash in the URL — the
 *      `detectSessionInUrl` option in `supabaseClient.ts` picks it up
 *      and the `authStore` transitions to `authenticated` via the
 *      existing `onAuthStateChange` listener.
 *   4. When the store reports `authenticated`, an effect redirects
 *      to the post-login landing page (onboarding if this device
 *      hasn't been claimed yet, otherwise the `next` query param
 *      or the root).
 *
 * If the deployment wasn't built with Supabase credentials, the page
 * shows an explanatory card instead of a broken form — this is the
 * expected state on the Phase 8 BYOK-only production deploy.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';
import { isAlreadyMigrated } from '../sync/migrateAnonymous';

export default function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const lastError = useAuthStore((s) => s.lastError);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const nextParam = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.get('next') || '/';
  }, [location.search]);

  const redirectTo = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}/login?next=${encodeURIComponent(nextParam)}`;
  }, [nextParam]);

  // Post-authentication landing: onboarding (for unclaimed devices)
  // or the requested `next` page.
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    let cancelled = false;
    void isAlreadyMigrated(user.id).then((claimed) => {
      if (cancelled) return;
      if (claimed) {
        navigate(nextParam, { replace: true });
      } else {
        navigate(
          `/onboarding?next=${encodeURIComponent(nextParam)}`,
          { replace: true }
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, user, nextParam, navigate]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) return;
    setSending(true);
    try {
      const ok = await signInWithEmail(trimmed, redirectTo);
      setSent(ok);
    } finally {
      setSending(false);
    }
  };

  if (status === 'unconfigured') {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center">
          <h1 className="text-xl font-bold text-slate-100">Sign-in unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            This deployment was built without Supabase credentials, so cross-device
            sync and accounts are turned off. Everything else still works — your
            games and weakness profile live in this browser's IndexedDB.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            To enable sign-in, set{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px]">VITE_SUPABASE_URL</code>{' '}
            and{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px]">VITE_SUPABASE_ANON_KEY</code>{' '}
            in your Vercel project and redeploy.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-6">
        <h1 className="text-xl font-bold text-slate-100">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          We'll email you a one-time magic link. No password, no tracking — just a
          way to sync your games and weakness profile across devices.
        </p>

        {status === 'loading' && (
          <p className="mt-4 text-xs text-slate-500">Checking session…</p>
        )}

        {!sent && status !== 'authenticated' && (
          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Email
              </span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={sending || email.trim().length === 0}
              className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
            {lastError && (
              <p className="text-xs text-rose-300">{lastError}</p>
            )}
          </form>
        )}

        {sent && (
          <div className="mt-5 rounded border border-emerald-500/50 bg-emerald-900/30 p-4 text-sm text-emerald-100">
            Check your inbox at{' '}
            <span className="font-mono">{email}</span>. Click the link to finish
            signing in — you can close this tab.
          </div>
        )}

        {status === 'authenticated' && (
          <p className="mt-4 text-sm text-slate-300">
            You are signed in as{' '}
            <span className="font-mono">{user?.email}</span>.
          </p>
        )}
      </section>
    </main>
  );
}
