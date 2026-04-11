/**
 * Phase 5 NavShell.
 *
 * Page-level chrome: logo, nav links, right-side badges. Wraps the
 * routed page content via React Router's <Outlet />. Replaces the
 * old header block that lived inline in `App.tsx`.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useGameStore } from '../game/gameStore';
import {
  MAX_ANON_BRANCHES,
  countExplorationBranches,
} from '../lib/branchLimit';

const NAV_LINKS: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Play' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/mistakes', label: 'Mistakes' },
];

export default function NavShell() {
  const branchCount = useGameStore((s) => countExplorationBranches(s.tree));

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="flex items-baseline gap-6">
          <h1 className="text-xl font-bold tracking-tight">Chesster</h1>
          <nav className="flex items-center gap-1 text-sm">
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
          <span className="text-xs text-slate-500">
            Phase 5 — profile + persistence
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
            title="Exploration branches are capped for anonymous users. Sign in to unlock unlimited branches."
          >
            Branches: {branchCount}/{MAX_ANON_BRANCHES}
          </span>
          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
            LLM: off
          </span>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
