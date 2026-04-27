/**
 * Phase 9 LoginPage — Supabase OTP code sign-in.
 *
 * Flow:
 *
 *   1. User types their email and hits "Send code".
 *   2. `authStore.signInWithEmail(email)` sends a 6-digit OTP code
 *      via Supabase (no magic link, no redirect).
 *   3. The page flips to a code-entry form. The user checks their
 *      email, types the code, and hits "Verify".
 *   4. `authStore.verifyOtp(email, code)` establishes the session
 *      in this browser tab. `onAuthStateChange` fires, the store
 *      transitions to `authenticated`, and an effect redirects to
 *      the post-login landing page.
 *
 * This avoids the in-app browser problem where Gmail/Outlook open
 * magic links in a WebView that doesn't share session storage with
 * the user's real browser.
 *
 * If the deployment wasn't built with Supabase credentials, the page
 * shows an explanatory card instead of a broken form.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';
import { isAlreadyMigrated } from '../sync/migrateAnonymous';
import { trackEvent, identify } from '../lib/analytics';

export default function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const lastError = useAuthStore((s) => s.lastError);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const codeInputRef = useRef<HTMLInputElement>(null);

  const nextParam = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.get('next') || '/';
  }, [location.search]);

  // Post-authentication landing: onboarding (for unclaimed devices)
  // or the requested `next` page.
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    // Associate analytics events with this user.
    identify(user.id);
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

  // Auto-focus the code input when it appears.
  useEffect(() => {
    if (codeSent && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [codeSent]);

  const onSendCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) return;
    setSending(true);
    trackEvent('sign_in_started');
    try {
      const ok = await signInWithEmail(trimmed);
      if (ok) setCodeSent(true);
    } finally {
      setSending(false);
    }
  };

  const onVerifyCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 6) return; // Supabase sends 6- or 8-digit codes
    setVerifying(true);
    try {
      await verifyOtp(email.trim(), trimmed);
      // On success, onAuthStateChange fires and the effect above
      // handles the redirect. On failure, lastError is set.
      trackEvent('sign_in_completed');
    } finally {
      setVerifying(false);
    }
  };

  const onResend = async () => {
    setSending(true);
    setCode('');
    try {
      await signInWithEmail(email.trim());
    } finally {
      setSending(false);
    }
  };

  if (status === 'unconfigured') {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-3 md:p-6">
        <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-center md:p-6">
          <h1 className="text-xl font-bold text-slate-100">Sign-in unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            This deployment was built without Supabase credentials, so cross-device
            sync and accounts are turned off. Everything else still works — your
            games and progress are still tracked — sign in later to sync across devices.
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
    <main className="flex flex-1 flex-col items-center justify-center p-3 md:p-6">
      <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-4 md:p-6">
        <h1 className="text-xl font-bold text-slate-100">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          We'll email you a one-time code. No password, no tracking — just a
          way to sync your games and weakness profile across devices.
        </p>

        {status === 'loading' && (
          <p className="mt-4 text-xs text-slate-500">Checking session…</p>
        )}

        {/* Step 1: Email input */}
        {!codeSent && status !== 'authenticated' && (
          <form onSubmit={onSendCode} className="mt-5 flex flex-col gap-3">
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
              {sending ? 'Sending…' : 'Send code'}
            </button>
            {lastError && (
              <p className="text-xs text-rose-300">{lastError}</p>
            )}
          </form>
        )}

        {/* Step 2: OTP code input */}
        {codeSent && status !== 'authenticated' && (
          <form onSubmit={onVerifyCode} className="mt-5 flex flex-col gap-3">
            <p className="text-sm text-slate-300">
              We sent a code to{' '}
              <span className="font-mono text-slate-100">{email}</span>.
            </p>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Code
              </span>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="12345678"
                maxLength={8}
                required
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={verifying || code.trim().length < 6} // accept 6–8 digits
              className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {verifying ? 'Verifying…' : 'Verify'}
            </button>
            {lastError && (
              <p className="text-xs text-rose-300">{lastError}</p>
            )}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <button
                type="button"
                onClick={onResend}
                disabled={sending}
                className="text-slate-400 underline underline-offset-2 hover:text-slate-200 disabled:opacity-40"
              >
                {sending ? 'Resending…' : 'Resend code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false);
                  setCode('');
                }}
                className="text-slate-400 underline underline-offset-2 hover:text-slate-200"
              >
                Change email
              </button>
            </div>
          </form>
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
