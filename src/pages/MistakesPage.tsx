/**
 * Mistakes page — flat WeaknessEvent log with motif + phase filters.
 *
 * Pure client-side filter: reads the profile, filters the event array,
 * renders the latest N rows. Each row is (currently) non-interactive;
 * Phase 6 will turn each into a "jump to position" action when the
 * Library / Practice views land.
 */

import { useMemo, useState } from 'react';
import { useProfileStore } from '../profile/profileStore';
import { MOTIF_IDS, MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import type { GamePhase } from '../tagging/phaseDetector';
import { QUALITY_COLORS, QUALITY_LABELS } from '../game/moveClassifier';

type MotifFilter = 'all' | MotifId;
type PhaseFilter = 'all' | GamePhase;

const PHASE_FILTERS: Array<{ value: PhaseFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'opening', label: 'Opening' },
  { value: 'middlegame', label: 'Middlegame' },
  { value: 'endgame', label: 'Endgame' },
];

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
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

  return (
    <main className="mx-auto flex max-w-4xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">Mistakes</h1>
        <p className="text-sm text-slate-400">
          Every inaccuracy, mistake, and blunder you've made. Kept locally.
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
        <ol className="flex flex-col gap-2">
          {filtered.map((e) => (
            <li
              key={e.id}
              className="rounded border border-slate-800 bg-slate-900/60 p-3 text-xs"
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
                <span className="ml-auto text-slate-500">
                  {formatDate(e.timestamp)}
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
                <span className="text-slate-500">
                  · {Math.round(e.cpLoss)}cp lost
                </span>
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
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
