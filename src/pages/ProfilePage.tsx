/**
 * Phase 10 ProfilePage — player stats and weakness overview.
 *
 * Reads from the profile store to display:
 *   - Total games, total moves, latest ACPL
 *   - ACPL trend (last 20 games, text-based sparkline)
 *   - Top weakness motifs by decayed count
 *   - Phase-based CP loss breakdown (opening / middlegame / endgame)
 */

import { NavLink } from 'react-router-dom';
import { useProfileStore } from '../profile/profileStore';
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

  // Average ACPL across all recorded games.
  const avgAcpl =
    acplHistory.length > 0
      ? acplHistory.reduce((sum, e) => sum + e.acpl, 0) / acplHistory.length
      : null;

  const latestAcpl =
    acplHistory.length > 0
      ? acplHistory[acplHistory.length - 1].acpl
      : null;

  // Top motifs sorted by decayed count (descending).
  const topMotifs = Object.entries(motifCounts)
    .filter(([, c]) => c.decayedCount > 0.1)
    .sort(([, a], [, b]) => b.decayedCount - a.decayedCount)
    .slice(0, 8);

  // ACPL sparkline (last 20 entries).
  const sparkData = acplHistory.slice(-20);

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
          label="Average ACPL"
          value={avgAcpl != null ? avgAcpl.toFixed(1) : '—'}
        />
        <StatCard
          label="Latest ACPL"
          value={latestAcpl != null ? latestAcpl.toFixed(1) : '—'}
        />
      </section>

      {/* ACPL Trend */}
      {sparkData.length > 1 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            ACPL Trend (last {sparkData.length} games)
          </h2>
          <AcplSparkline data={sparkData.map((e) => e.acpl)} />
        </section>
      )}

      {/* Phase CP Loss */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">
          Average CP Loss by Phase
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <PhaseBar label="Opening" value={phaseCpLoss.opening} />
          <PhaseBar label="Middlegame" value={phaseCpLoss.middlegame} />
          <PhaseBar label="Endgame" value={phaseCpLoss.endgame} />
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <span className="text-2xl font-bold tabular-nums text-slate-100">
        {value}
      </span>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

/** Simple text-based bar chart for ACPL values. */
function AcplSparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 50); // floor at 50 so small values still show
  return (
    <div className="flex items-end gap-1" style={{ height: '80px' }}>
      {data.map((v, i) => {
        const pct = Math.min(100, (v / max) * 100);
        const color =
          v < 30
            ? 'bg-emerald-500'
            : v < 60
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
              title={`Game ${i + 1}: ${v.toFixed(1)} ACPL`}
            />
          </div>
        );
      })}
    </div>
  );
}

function PhaseBar({ label, value }: { label: string; value: number }) {
  const maxBar = 200; // cp loss ceiling for visual bar
  const pct = Math.min(100, (value / maxBar) * 100);
  const color =
    value < 30
      ? 'bg-emerald-500'
      : value < 80
        ? 'bg-amber-500'
        : 'bg-rose-500';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono tabular-nums text-slate-200">
          {value.toFixed(0)}
        </span>
      </div>
      <div className="h-2 rounded bg-slate-800">
        <div
          className={`h-full rounded ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MotifRow({ id, counter }: { id: string; counter: MotifCounter }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-300">{motifLabel(id)}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono tabular-nums text-slate-500">
          {counter.count}x
        </span>
        <span className="font-mono tabular-nums text-slate-400">
          {counter.cpLossTotal.toFixed(0)}cp total
        </span>
      </div>
    </div>
  );
}
