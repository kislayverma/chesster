/**
 * Phase 10 ProfilePage — player stats and weakness overview.
 *
 * Reads from the profile store to display:
 *   - Total games, total moves, estimated rating + standing
 *   - Rating trend (last 20 games, bar chart)
 *   - Phase-based estimated rating (opening / middlegame / endgame)
 *   - Top weakness motifs by decayed count
 */

import { NavLink } from 'react-router-dom';
import { useProfileStore } from '../profile/profileStore';
import { acplToRating, ratingStanding } from '../lib/rating';
import type { MotifCounter } from '../profile/types';

/** Human-readable labels for motif IDs. */
const MOTIF_LABELS: Record<string, string> = {
  hangingPiece: 'Hanging piece',
  missedFork: 'Missed fork',
  missedPin: 'Missed pin',
  missedSkewer: 'Missed skewer',
  overloadedDefender: 'Overloaded defender',
  kingSafetyDrop: 'King safety drop',
  badEndgameTrade: 'Bad endgame trade',
  undefendedPiece: 'Undefended piece',
  weakBackRank: 'Weak back rank',
  pawnStructure: 'Pawn structure',
};

function motifLabel(id: string): string {
  return MOTIF_LABELS[id] ?? id.replace(/([A-Z])/g, ' $1').trim();
}

export default function ProfilePage() {
  const profile = useProfileStore((s) => s.profile);
  const hydrated = useProfileStore((s) => s.hydrated);
  const clearProfile = useProfileStore((s) => s.clearProfile);

  if (!hydrated) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-slate-500">Loading profile...</p>
      </main>
    );
  }

  const { totalGames, totalMoves, acplHistory, motifCounts, phaseCpLoss } =
    profile;

  if (totalGames === 0) {
    return (
      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-slate-400">
          No games yet. Play a game to start building your profile.
        </p>
        <NavLink
          to="/play"
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Play now
        </NavLink>
      </main>
    );
  }

  // Average and latest ratings derived from ACPL.
  const avgAcpl =
    acplHistory.length > 0
      ? acplHistory.reduce((sum, e) => sum + e.acpl, 0) / acplHistory.length
      : null;
  const avgRating = avgAcpl != null ? acplToRating(avgAcpl) : null;

  const latestAcpl =
    acplHistory.length > 0
      ? acplHistory[acplHistory.length - 1].acpl
      : null;
  const latestRating = latestAcpl != null ? acplToRating(latestAcpl) : null;
  const latestStanding = latestRating != null ? ratingStanding(latestRating) : null;

  // Top motifs sorted by decayed count (descending).
  const topMotifs = Object.entries(motifCounts)
    .filter(([, c]) => c.decayedCount > 0.1)
    .sort(([, a], [, b]) => b.decayedCount - a.decayedCount)
    .slice(0, 8);

  // Rating trend (last 20 entries, converted from ACPL).
  const sparkData = acplHistory.slice(-20).map((e) => acplToRating(e.acpl));

  // Phase ratings derived from phase ACPL.
  const phaseRatings = {
    opening: acplToRating(phaseCpLoss.opening),
    middlegame: acplToRating(phaseCpLoss.middlegame),
    endgame: acplToRating(phaseCpLoss.endgame),
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            Profile
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Your chess journey — track your growth and sharpen your weaknesses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm('Clear your entire profile? This cannot be undone.')) {
              clearProfile();
            }
          }}
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Clear profile
        </button>
      </header>

      {/* Summary stats */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Games" value={String(totalGames)} />
        <StatCard label="Moves analyzed" value={String(totalMoves)} />
        <StatCard
          label="Average Rating"
          value={avgRating != null ? String(avgRating) : '—'}
          subtitle={avgRating != null ? ratingStanding(avgRating) : undefined}
        />
        <StatCard
          label="Latest Rating"
          value={latestRating != null ? String(latestRating) : '—'}
          subtitle={latestStanding ?? undefined}
        />
      </section>

      {/* Rating Trend */}
      {sparkData.length > 1 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Rating Trend (last {sparkData.length} games)
          </h2>
          <RatingSparkline data={sparkData} />
        </section>
      )}

      {/* Phase Ratings */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">
          Estimated Rating by Phase
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <PhaseBar label="Opening" rating={phaseRatings.opening} />
          <PhaseBar label="Middlegame" rating={phaseRatings.middlegame} />
          <PhaseBar label="Endgame" rating={phaseRatings.endgame} />
        </div>
      </section>

      {/* Top Weaknesses */}
      {topMotifs.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Top Weaknesses
          </h2>
          <div className="flex flex-col gap-2">
            {topMotifs.map(([id, counter]) => (
              <MotifRow key={id} id={id} counter={counter} />
            ))}
          </div>
        </section>
      )}
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

/** Bar chart for rating values — taller = higher rating = better. */
function RatingSparkline({ data }: { data: number[] }) {
  const min = Math.min(...data, 400);
  const max = Math.max(...data, 2800);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-1" style={{ height: '80px' }}>
      {data.map((rating, i) => {
        const pct = Math.max(5, ((rating - min) / range) * 100);
        const color =
          rating >= 1800
            ? 'bg-emerald-500'
            : rating >= 1200
              ? 'bg-amber-500'
              : 'bg-rose-500';
        return (
          <div
            key={i}
            className="flex flex-1 flex-col items-center justify-end"
            style={{ height: '100%' }}
          >
            <div
              className={`w-full min-w-[4px] rounded-t ${color}`}
              style={{ height: `${pct}%` }}
              title={`Game ${i + 1}: ~${rating} (${ratingStanding(rating)})`}
            />
          </div>
        );
      })}
    </div>
  );
}

function PhaseBar({ label, rating }: { label: string; rating: number }) {
  const pct = Math.min(100, (rating / 2800) * 100);
  const color =
    rating >= 1800
      ? 'bg-emerald-500'
      : rating >= 1200
        ? 'bg-amber-500'
        : 'bg-rose-500';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono tabular-nums text-slate-200">
          ~{rating}
        </span>
      </div>
      <div className="h-2 rounded bg-slate-800">
        <div
          className={`h-full rounded ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500">
        {ratingStanding(rating)}
      </span>
    </div>
  );
}

function MotifRow({ id, counter }: { id: string; counter: MotifCounter }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-300">{motifLabel(id)}</span>
      <span className="font-mono tabular-nums text-slate-500">
        {counter.count} occurrence{counter.count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
