/**
 * Phase 7 NavShell.
 *
 * Page-level chrome: logo, nav links, right-side badges. Wraps the
 * routed page content via React Router's <Outlet />.
 *
 * On mobile (<lg) the nav links collapse into a hamburger menu that
 * opens a vertical dropdown. The logo and auth menu stay visible.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { stackDepth } from '../game/gameTree';
import { MAX_ANON_BRANCHES } from '../lib/branchLimit';
import { getLlmMode, subscribeLlmMode, type LlmMode } from '../lib/featureFlags';
import { useAuthStore } from '../auth/authStore';

const NAV_LINKS: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Home' },
  { to: '/play', label: 'Play' },
  { to: '/mistakes', label: 'Mistakes' },
  { to: '/practice', label: 'Practice' },
  { to: '/library', label: 'Library' },
  { to: '/profile', label: 'Profile' },
  { to: '/settings', label: 'Settings' },
];

const LLM_BADGE_LABELS: Record<LlmMode, string> = {
  off: 'LLM: off',
  'byok-only': 'LLM: BYOK',
  'free-tier': 'LLM: free tier',
};

const LLM_BADGE_CLASSES: Record<LlmMode, string> = {
  off: 'bg-slate-800 text-slate-300 hover:bg-slate-700',
  'byok-only': 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60',
  'free-tier': 'bg-sky-900/40 text-sky-200 hover:bg-sky-900/60',
};

export default function NavShell() {
  const depth = useGameStore((s) => stackDepth(s.tree));
  const [llmMode, setLlmMode] = useState<LlmMode>(getLlmMode());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => subscribeLlmMode(setLlmMode), []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-800 px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 lg:items-baseline lg:gap-6">
            <h1 className="text-xl font-bold tracking-tight">Chesster</h1>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 text-sm lg:flex">
              {NAV_LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `rounded px-3 py-1 ${
                      isActive
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {/* Badges — hidden on mobile, shown on desktop */}
            <span
              className="hidden rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 lg:inline-block"
              title="Exploration frames on top of the mainline. Anonymous users are capped; sign in for unlimited."
            >
              Stack: {depth}/{MAX_ANON_BRANCHES}
            </span>
            <NavLink
              to="/settings"
              title="Click to manage your Anthropic API key"
              className={`hidden rounded px-2 py-1 text-xs transition-colors lg:inline-block ${LLM_BADGE_CLASSES[llmMode]}`}
            >
              {LLM_BADGE_LABELS[llmMode]}
            </NavLink>
            <AuthMenu />

            {/* Hamburger button — mobile only */}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 lg:hidden"
              aria-label="Toggle menu"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <nav className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3 lg:hidden">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `rounded px-3 py-2 text-sm ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            {/* Mobile-only badges */}
            <div className="mt-2 flex items-center gap-2 border-t border-slate-800 px-3 pt-3">
              <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                Stack: {depth}/{MAX_ANON_BRANCHES}
              </span>
              <NavLink
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className={`rounded px-2 py-1 text-xs transition-colors ${LLM_BADGE_CLASSES[llmMode]}`}
              >
                {LLM_BADGE_LABELS[llmMode]}
              </NavLink>
            </div>
          </nav>
        )}
      </header>

      <Outlet />
    </div>
  );
}

/**
 * Right-side auth control: shows a "Sign in" NavLink when anonymous,
 * the user's email + a sign-out button when authenticated, and a
 * static "Local only" chip when this deployment was built without
 * Supabase credentials (Phase 8 BYOK-only deploy).
 */
function AuthMenu() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const syncing = useAuthStore((s) => s.syncing);
  const signOut = useAuthStore((s) => s.signOut);

  if (status === 'loading') {
    return (
      <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-500">
        …
      </span>
    );
  }

  if (status === 'unconfigured') {
    return (
      <span
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-500"
        title="This deployment was built without Supabase credentials. Sync is disabled."
      >
        Local only
      </span>
    );
  }

  if (status === 'authenticated') {
    return (
      <div className="flex items-center gap-2">
        {syncing && (
          <span
            className="hidden rounded bg-amber-900/40 px-2 py-1 text-xs text-amber-200 sm:inline-block"
            title="Downloading your remote profile"
          >
            Syncing…
          </span>
        )}
        <span
          className="hidden max-w-[14ch] truncate rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 sm:inline-block"
          title={user?.email ?? undefined}
        >
          {user?.email ?? 'Signed in'}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          Sign out
        </button>
      </div>
    );
  }

  // Anonymous.
  return (
    <NavLink
      to="/login"
      className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-slate-950 hover:bg-amber-500"
    >
      Sign in
    </NavLink>
  );
}
