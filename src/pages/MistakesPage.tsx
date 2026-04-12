/**
 * Mistakes page — WeaknessEvent log grouped by date, with motif + phase
 * filters. Each mistake card links to its game in the library at the
 * exact move where the mistake occurred.
 */

import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useProfileStore } from '../profile/profileStore';
import { MOTIF_IDS, MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import type { GamePhase } from '../tagging/phaseDetector';
import { QUALITY_COLORS, QUALITY_LABELS } from '../game/moveClassifier';
import type { WeaknessEvent } from '../profile/types';

type MotifFilter = 'all' | MotifId;
type PhaseFilter = 'all' | GamePhase;

const PHASE_FILTERS: Array<{ value: PhaseFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'opening', label: 'Opening' },
  { value: 'middlegame', label: 'Middlegame' },
  { value: 'endgame', label: 'Endgame' },
];

/** Format a timestamp to a date-only string for grouping (e.g. "Apr 12, 2026"). */
function formatDateGroup(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ts));
  } catch {
    return 'Unknown date';
  }
}

/** Format a timestamp to a time string for individual cards. */
function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

/** Build the review URL for a mistake, pointing to the exact move. */
function reviewUrl(e: WeaknessEvent): string {
  return `/library/${e.gameId}?move=${e.moveNumber}&color=${e.color}`;
}

/** Group events by date string, preserving order. */
function groupByDate(
  events: WeaknessEvent[],
): Array<{ date: string; events: WeaknessEvent[] }> {
  const groups: Array<{ date: string; events: WeaknessEvent[] }> = [];
  const seen = new Map<string, WeaknessEvent[]>();

  for (const e of events) {
    const key = formatDateGroup(e.timestamp);
    const existing = seen.get(key);
    if (existing) {
      existing.push(e);
    } else {
      const arr = [e];
      seen.set(key, arr);
      groups.push({ date: key, events: arr });
    }
  }
  return groups;
}

export default function MistakesPage() {
  const events = useProfileStore((s) => s.profile.weaknessEvents);
  const [motifFilter, setMotifFilter] = useState<MotifFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');

  const filtered = useMemo(() => {
    return [...events]
      .reverse() // newest first
      .filter((e) => {
        if (motifFilter !== 'all' && !e.motifs.includes(motifFilter)) return false;
        if (phaseFilter !== 'all' && e.phase !== phaseFilter) return false;
        return true;
      });
  }, [events, motifFilter, phaseFilter]);

  const dateGroups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <main className="mx-auto flex max-w-4xl flex-1 flex-col gap-4 p-3 md:gap-6 md:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">Mistakes</h1>
        <p className="text-sm text-slate-400">
          Every inaccuracy, mistake, and blunder — click any card to review it in the game.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Motif
          </label>
          <select
            value={motifFilter}
            onChange={(e) => setMotifFilter(e.target.value as MotifFilter)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            <option value="all">All motifs</option>
            {MOTIF_IDS.map((m) => (
              <option key={m} value={m}>
                {MOTIF_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Phase
          </label>
          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value as PhaseFilter)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            {PHASE_FILTERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">
          No mistakes yet{events.length > 0 ? ' for this filter' : ''}.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {dateGroups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span className="h-px flex-1 bg-slate-800" />
                <span>{group.date}</span>
                <span className="h-px flex-1 bg-slate-800" />
              </h2>
              <ol className="flex flex-col gap-2">
                {group.events.map((e) => (
                  <li key={e.id}>
                    <NavLink
                      to={reviewUrl(e)}
                      className="group block rounded border border-slate-800 bg-slate-900/60 p-3 text-xs transition-colors hover:border-slate-700 hover:bg-slate-900/80"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${QUALITY_COLORS[e.quality]}`}
                        >
                          {QUALITY_LABELS[e.quality]}
                        </span>
                        <span className="text-slate-400">
                          Move {e.moveNumber} · {e.color}
                        </span>
                        <span className="text-slate-500">· {e.phase}</span>
                        <span className="ml-auto flex items-center gap-2">
                          <span className="text-slate-500">
                            {formatTime(e.timestamp)}
                          </span>
                          <span className="text-slate-600 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                            Review &rarr;
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                        <span className="text-slate-200">
                          You played{' '}
                          <span className="font-semibold text-rose-300">
                            {e.playerMove}
                          </span>
                        </span>
                        {e.bestMove && (
                          <span className="text-slate-200">
                            · best was{' '}
                            <span className="font-semibold text-emerald-300">
                              {e.bestMove}
                            </span>
                          </span>
                        )}
                      </div>
                      {e.motifs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.motifs.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
                            >
                              {MOTIF_LABELS[m as MotifId] ?? m}
                            </span>
                          ))}
                        </div>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
