/**
 * ProfilePage — player stats, narrative, and weakness overview.
 *
 * Shows:
 *   - "Your Story" narrative paragraph
 *   - Summary stats (games, moves, avg rating, latest rating)
 *   - Rating trend (last 20 games)
 *   - Phase-based estimated rating
 *   - Weaknesses split into: Watch out / Improving / Retired
 *   - Opening insights (best/worst ECO codes)
 */

import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';
import { useProfileStore } from '../profile/profileStore';
import { acplToRating, ratingStanding } from '../lib/rating';
import {
  getTopWeaknesses,
  getRetiredWeaknesses,
} from '../profile/weaknessSelector';
import { computePlayerNarrative } from '../profile/playerNarrative';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import type { OpeningStat } from '../profile/types';
import JourneyCard from '../components/JourneyCard';
import { hasLLM, withByokHeader } from '../lib/featureFlags';

function motifLabel(id: string): string {
  return MOTIF_LABELS[id as MotifId] ?? id.replace(/_/g, ' ');
}

export default function ProfilePage() {
  const profile = useProfileStore((s) => s.profile);
  const hydrated = useProfileStore((s) => s.hydrated);
  const clearProfile = useProfileStore((s) => s.clearProfile);
  const authStatus = useAuthStore((s) => s.status);
  const syncing = useAuthStore((s) => s.syncing);
  const isAuthenticated = authStatus === 'authenticated';

  // Compute narrative
  const narrative = useMemo(
    () => (profile.totalGames > 0 ? computePlayerNarrative(profile) : null),
    [profile],
  );

  // LLM-enriched narrative (optional, async).
  const [llmNarrative, setLlmNarrative] = useState<string | null>(null);
  useEffect(() => {
    if (!narrative || !hasLLM()) return;
    let cancelled = false;
    const fetchLlm = async () => {
      try {
        const res = await fetch('/api/player-narrative', {
          method: 'POST',
          headers: withByokHeader({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            templateNarrative: narrative.text,
            data: narrative.data,
          }),
        });
        if (!res.ok || cancelled) return;
        const body = await res.json() as { narrative?: string };
        if (!cancelled && typeof body.narrative === 'string') {
          setLlmNarrative(body.narrative);
        }
      } catch {
        // Silent fallback — template stays.
      }
    };
    void fetchLlm();
    return () => { cancelled = true; };
  }, [narrative]);

  // Weakness categories
  const { watchOut, improving, retired } = useMemo(() => {
    const top = getTopWeaknesses(profile, 8);
    const ret = getRetiredWeaknesses(profile);

    // Split top weaknesses: "improving" = decayedCount < count * 0.3
    // (recent occurrences are significantly fewer than lifetime)
    const watch: typeof top = [];
    const imp: typeof top = [];
    for (const w of top) {
      // If decayedCount is less than 30% of lifetime count, they're improving
      const ratio = w.count > 0 ? w.decayedCount / w.count : 0;
      if (ratio < 0.3 && w.count >= 3) {
        imp.push(w);
      } else {
        watch.push(w);
      }
    }
    return { watchOut: watch, improving: imp, retired: ret };
  }, [profile]);

  // Opening insights
  const openingInsights = useMemo(() => {
    const entries = Object.entries(profile.openingWeaknesses)
      .filter(([, stat]) => stat.games >= 3);
    if (entries.length < 2) return null;

    const sorted = [...entries].sort(
      ([, a], [, b]) => a.avgCpLoss - b.avgCpLoss,
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    // Only show if there's a meaningful difference
    if (worst[1].avgCpLoss - best[1].avgCpLoss < 15) return null;
    return { best, worst };
  }, [profile]);

  if (!hydrated || syncing) {
    return (
      <main className="flex flex-1 items-center justify-center p-3 md:p-6">
        <p className="text-sm text-slate-500">Loading profile...</p>
      </main>
    );
  }

  const { totalGames, totalMoves, acplHistory, phaseCpLoss } = profile;

  if (totalGames === 0) {
    return (
      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-4 p-3 md:p-6">
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
  const latestStanding =
    latestRating != null ? ratingStanding(latestRating) : null;

  // Rating trend (last 20 entries).
  const sparkData = acplHistory.slice(-20).map((e) => acplToRating(e.acpl));

  // Phase ratings.
  const phaseRatings = {
    opening: acplToRating(phaseCpLoss.opening),
    middlegame: acplToRating(phaseCpLoss.middlegame),
    endgame: acplToRating(phaseCpLoss.endgame),
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-4 p-3 md:gap-6 md:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
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

      {/* Your Story — narrative paragraph */}
      {narrative && (
        <section className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4">
          <h2 className="mb-2 text-sm font-semibold text-emerald-300">
            Your Story
          </h2>
          <p className="text-sm leading-relaxed text-slate-300">
            {llmNarrative ?? narrative.text}
          </p>
        </section>
      )}

      {/* Journey section — only for authenticated users */}
      {isAuthenticated && <JourneyCard />}

      {/* Summary stats */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Games" value={String(totalGames)} />
        <StatCard label="Moves analyzed" value={String(totalMoves)} />
        <StatCard
          label="Average Rating"
          value={avgRating != null ? String(avgRating) : '\u2014'}
          subtitle={avgRating != null ? ratingStanding(avgRating) : undefined}
        />
        <StatCard
          label="Latest Rating"
          value={latestRating != null ? String(latestRating) : '\u2014'}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <PhaseBar label="Opening" rating={phaseRatings.opening} />
          <PhaseBar label="Middlegame" rating={phaseRatings.middlegame} />
          <PhaseBar label="Endgame" rating={phaseRatings.endgame} />
        </div>
      </section>

      {/* Weaknesses — split view */}
      {(watchOut.length > 0 || improving.length > 0 || retired.length > 0) && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Weaknesses
          </h2>

          {/* Watch out */}
          {watchOut.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-amber-400">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                Watch out
              </div>
              <div className="flex flex-col gap-1.5">
                {watchOut.map((w) => (
                  <WeaknessRow
                    key={w.motif}
                    label={motifLabel(w.motif)}
                    count={w.count}
                    decayedCount={w.decayedCount}
                    accent="amber"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Improving */}
          {improving.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-sky-400">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
                Improving
              </div>
              <div className="flex flex-col gap-1.5">
                {improving.map((w) => (
                  <WeaknessRow
                    key={w.motif}
                    label={motifLabel(w.motif)}
                    count={w.count}
                    decayedCount={w.decayedCount}
                    accent="sky"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Retired */}
          {retired.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                Conquered
              </div>
              <div className="flex flex-wrap gap-1.5">
                {retired.map((w) => (
                  <span
                    key={w.motif}
                    className="rounded bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-300"
                  >
                    {motifLabel(w.motif)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Opening Insights */}
      {openingInsights && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Opening Insights
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OpeningCard
              label="Strongest"
              eco={openingInsights.best[0]}
              stat={openingInsights.best[1]}
              accent="emerald"
            />
            <OpeningCard
              label="Weakest"
              eco={openingInsights.worst[0]}
              stat={openingInsights.worst[1]}
              accent="rose"
            />
          </div>
        </section>
      )}
    </main>
  );
}

/* ─── Sub-components ───────────────────────────────────────────────── */

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

function WeaknessRow({
  label,
  count,
  decayedCount,
  accent,
}: {
  label: string;
  count: number;
  decayedCount: number;
  accent: 'amber' | 'sky';
}) {
  // Bar width based on decayedCount relative to a reasonable max (10)
  const barPct = Math.min(100, (decayedCount / 10) * 100);
  const barColor = accent === 'amber' ? 'bg-amber-500/60' : 'bg-sky-500/60';

  return (
    <div className="relative flex items-center justify-between rounded bg-slate-900/60 px-2.5 py-1.5 text-xs">
      <div
        className={`absolute inset-y-0 left-0 rounded ${barColor}`}
        style={{ width: `${barPct}%` }}
      />
      <span className="relative z-10 text-slate-200">{label}</span>
      <span className="relative z-10 font-mono tabular-nums text-slate-500">
        {count}×
      </span>
    </div>
  );
}

function OpeningCard({
  label,
  eco,
  stat,
  accent,
}: {
  label: string;
  eco: string;
  stat: OpeningStat;
  accent: 'emerald' | 'rose';
}) {
  const borderColor =
    accent === 'emerald' ? 'border-emerald-900/50' : 'border-rose-900/50';
  const labelColor =
    accent === 'emerald' ? 'text-emerald-400' : 'text-rose-400';
  const ecoRating = acplToRating(stat.avgCpLoss);

  return (
    <div
      className={`rounded border ${borderColor} bg-slate-900/60 px-3 py-2.5`}
    >
      <div className={`text-[10px] font-medium uppercase tracking-wider ${labelColor}`}>
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-200">{eco}</div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
        <span>{stat.games} game{stat.games !== 1 ? 's' : ''}</span>
        <span>~{ecoRating} rating</span>
      </div>
    </div>
  );
}
