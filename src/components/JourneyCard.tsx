/**
 * JourneyCard — shows current level, progress bar, rolling rating,
 * next milestone, and focus areas.  Only rendered for authenticated users.
 */

import { useProfileStore } from '../profile/profileStore';
import { getLevelDef, nextLevel, acplToRating, ratingStanding } from '../lib/rating';
import { levelFocusAreas, MIN_GAMES_FOR_PROMOTION } from '../lib/journey';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';

export default function JourneyCard() {
  const journey = useProfileStore((s) => s.profile.journeyState);
  const acplHistory = useProfileStore((s) => s.profile.acplHistory);
  const totalGames = useProfileStore((s) => s.profile.totalGames);

  if (!journey) return null;

  const current = getLevelDef(journey.currentLevel);
  const next = nextLevel(journey.currentLevel);
  const focusMotifs = levelFocusAreas(journey.currentLevel);
  // Guard: no games played yet means 0% progress regardless of stored state.
  const effectiveProgress = totalGames > 0 ? journey.levelProgress : 0;

  // Sparkline: last 10 game ratings
  const sparkData = acplHistory.slice(-10).map((e) => acplToRating(e.acpl));

  const pointsToNext = next
    ? Math.max(0, next.floor - journey.rollingRating)
    : 0;

  const gamesNeeded = Math.max(0, MIN_GAMES_FOR_PROMOTION - journey.gamesAtCurrentLevel);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      {/* Level header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-100">{current.name}</h2>
          <p className="text-xs text-slate-400">{current.description}</p>
        </div>
        <div className="text-right">
          <span className="font-mono text-xl tabular-nums text-slate-200">
            ~{journey.rollingRating}
          </span>
          {journey.rollingRating > 0 && (
            <p className="text-[11px] text-slate-400">
              {ratingStanding(journey.rollingRating)}
            </p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {next && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Progress to {next.name}
            </span>
            <span className="font-mono tabular-nums text-slate-300">
              {effectiveProgress}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${effectiveProgress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {pointsToNext > 0
              ? `${pointsToNext} rating points to go`
              : gamesNeeded > 0
                ? `Rating reached — play ${gamesNeeded} more game${gamesNeeded !== 1 ? 's' : ''} at this level to promote`
                : 'Rating threshold reached — keep playing to level up!'}
          </p>
        </div>
      )}

      {!next && (
        <p className="mt-3 text-xs text-emerald-400">
          You have reached the highest level. Keep sharpening your game!
        </p>
      )}

      {/* Rating sparkline */}
      {sparkData.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Last {sparkData.length} games
          </div>
          <MiniSparkline data={sparkData} />
        </div>
      )}

      {/* Focus areas */}
      {focusMotifs.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            Focus areas for {current.name}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {focusMotifs.map((m) => (
              <span
                key={m}
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {MOTIF_LABELS[m as MotifId] ?? m}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  const min = Math.min(...data) - 50;
  const max = Math.max(...data) + 50;
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-0.5" style={{ height: '32px' }}>
      {data.map((rating, i) => {
        const pct = Math.max(8, ((rating - min) / range) * 100);
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
              className={`w-full min-w-[3px] rounded-t ${color}`}
              style={{ height: `${pct}%` }}
              title={`~${rating}`}
            />
          </div>
        );
      })}
    </div>
  );
}
