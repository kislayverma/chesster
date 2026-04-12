/**
 * Phase 10 HomePage — landing page with hero and feature pitch.
 *
 * Shows a short pitch, quick-start CTA to jump into a game, and
 * a summary of recent activity (total games, current ACPL trend).
 */

import { NavLink } from 'react-router-dom';
import { useProfileStore } from '../profile/profileStore';

export default function HomePage() {
  const totalGames = useProfileStore((s) => s.profile.totalGames);
  const totalMoves = useProfileStore((s) => s.profile.totalMoves);
  const acplHistory = useProfileStore((s) => s.profile.acplHistory);

  const latestAcpl =
    acplHistory.length > 0
      ? acplHistory[acplHistory.length - 1].acpl.toFixed(1)
      : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 p-6">
      {/* Hero */}
      <section className="flex max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-100">
          Welcome to Chesster
        </h1>
        <p className="text-lg leading-relaxed text-slate-400">
          Play against Stockfish, get move-by-move coaching from an AI coach,
          and track your weaknesses over time — all in your browser.
        </p>
        <NavLink
          to="/play"
          className="mt-2 rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white shadow-lg hover:bg-emerald-500 transition-colors"
        >
          Play now
        </NavLink>
      </section>

      {/* Quick stats */}
      {totalGames > 0 && (
        <section className="grid w-full max-w-lg grid-cols-3 gap-4">
          <StatCard label="Games played" value={String(totalGames)} />
          <StatCard label="Moves analyzed" value={String(totalMoves)} />
          <StatCard
            label="Latest ACPL"
            value={latestAcpl ?? '—'}
            subtitle={latestAcpl ? 'avg centipawn loss' : 'play a game first'}
          />
        </section>
      )}

      {/* Feature cards */}
      <section className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
        <FeatureCard
          title="AI Coach"
          description="Get personalized explanations for every mistake, powered by Claude."
          linkTo="/play"
          linkLabel="Start playing"
        />
        <FeatureCard
          title="Game Library"
          description="Revisit any game, replay your moves, and learn from every mistake."
          linkTo="/library"
          linkLabel="View library"
        />
        <FeatureCard
          title="Your Profile"
          description="Track your ACPL trend, top weaknesses, and opening stats."
          linkTo="/profile"
          linkLabel="View profile"
        />
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <span className="text-2xl font-bold tabular-nums text-slate-100">
        {value}
      </span>
      <span className="text-xs text-slate-400">{label}</span>
      {subtitle && (
        <span className="mt-0.5 text-[10px] text-slate-500">{subtitle}</span>
      )}
    </div>
  );
}

function FeatureCard({
  title,
  description,
  linkTo,
  linkLabel,
}: {
  title: string;
  description: string;
  linkTo: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="flex-1 text-xs leading-relaxed text-slate-400">
        {description}
      </p>
      <NavLink
        to={linkTo}
        className="mt-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
      >
        {linkLabel} &rarr;
      </NavLink>
    </div>
  );
}
