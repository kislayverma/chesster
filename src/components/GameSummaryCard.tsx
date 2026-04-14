/**
 * Post-game summary card — narrative + phase breakdown + key moments.
 *
 * Renders above the move list on GameReviewPage. Shows:
 *   - A template-generated narrative paragraph
 *   - Phase breakdown bar (opening / middlegame / endgame)
 *   - Key moments cards (top 3 worst moves with coach text)
 *   - Focus area callout
 *
 * When an LLM-generated summary is available, the narrative paragraph
 * is replaced with the LLM text.
 */

import { useState } from 'react';
import type { GameSummary, KeyMoment } from '../game/gameSummary';
import type { GamePhase } from '../tagging/phaseDetector';
import { QUALITY_COLORS, QUALITY_LABELS } from '../game/moveClassifier';
import { MOTIF_LABELS } from '../tagging/motifs';

interface GameSummaryCardProps {
  summary: GameSummary;
  /** Optional LLM narrative to replace the template. */
  llmNarrative?: string | null;
  /** Navigate to a specific ply in the review board. */
  onPlyClick: (ply: number) => void;
}

const PHASE_LABELS: Record<GamePhase, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

const PHASE_COLORS: Record<GamePhase, string> = {
  opening: 'bg-sky-500',
  middlegame: 'bg-violet-500',
  endgame: 'bg-amber-500',
};

export default function GameSummaryCard({
  summary,
  llmNarrative,
  onPlyClick,
}: GameSummaryCardProps) {
  const [expandedMoment, setExpandedMoment] = useState<number | null>(null);

  const narrative = llmNarrative ?? summary.narrative;
  const totalMoves =
    summary.phases.opening.moves +
    summary.phases.middlegame.moves +
    summary.phases.endgame.moves;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        Game Summary
      </h2>

      {/* Narrative paragraph */}
      <p className="mb-4 text-sm leading-relaxed text-slate-300">
        {narrative}
      </p>

      {/* Phase breakdown bar */}
      {totalMoves > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-slate-400">
            Mistakes by phase
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded">
            {(['opening', 'middlegame', 'endgame'] as GamePhase[]).map(
              (phase) => {
                const ps = summary.phases[phase];
                if (ps.moves === 0) return null;
                const pct = (ps.moves / totalMoves) * 100;
                const bad = ps.blunders + ps.mistakes + ps.inaccuracies;
                return (
                  <div
                    key={phase}
                    className={`relative ${PHASE_COLORS[phase]} transition-all`}
                    style={{ width: `${pct}%`, minWidth: bad > 0 ? '20px' : undefined }}
                    title={`${PHASE_LABELS[phase]}: ${ps.moves} moves, ${bad} mistake${bad !== 1 ? 's' : ''}`}
                  >
                    {bad > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/90">
                        {bad}
                      </span>
                    )}
                  </div>
                );
              },
            )}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            {(['opening', 'middlegame', 'endgame'] as GamePhase[]).map(
              (phase) => {
                const ps = summary.phases[phase];
                if (ps.moves === 0) return null;
                return (
                  <span key={phase} className="flex items-center gap-1">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${PHASE_COLORS[phase]}`}
                    />
                    {PHASE_LABELS[phase]}
                  </span>
                );
              },
            )}
          </div>
        </div>
      )}

      {/* Key moments */}
      {summary.keyMoments.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-slate-400">Key moments</div>
          <div className="flex flex-col gap-1.5">
            {summary.keyMoments.map((km, idx) => (
              <KeyMomentCard
                key={km.ply}
                moment={km}
                isExpanded={expandedMoment === idx}
                onToggle={() =>
                  setExpandedMoment(expandedMoment === idx ? null : idx)
                }
                onNavigate={() => onPlyClick(km.ply)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Focus areas */}
      {summary.motifTally.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs text-slate-400">
            Focus areas this game
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.motifTally.map((t) => (
              <span
                key={t.motif}
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {MOTIF_LABELS[t.motif] ?? t.motif}
                {t.count > 1 && (
                  <span className="ml-1 text-slate-500">{t.count}×</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Key Moment Card ──────────────────────────────────────────────── */

function KeyMomentCard({
  moment,
  isExpanded,
  onToggle,
  onNavigate,
}: {
  moment: KeyMoment;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-800/40"
        onClick={onToggle}
      >
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${QUALITY_COLORS[moment.quality]}`}
        >
          {QUALITY_LABELS[moment.quality]}
        </span>
        <span className="text-slate-400">
          Move {moment.moveNumber}
        </span>
        <span className="font-mono text-slate-300">
          {moment.playerMove}
        </span>
        {moment.motifs.length > 0 && (
          <span className="ml-auto rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400">
            {MOTIF_LABELS[moment.motifs[0]] ?? moment.motifs[0]}
          </span>
        )}
        <span className="ml-1 text-slate-600">{isExpanded ? '−' : '+'}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-800 px-2.5 py-2">
          {/* Coach text from during the game */}
          {moment.coachText && (
            <p className="mb-2 text-slate-300 leading-relaxed">
              {moment.coachText}
            </p>
          )}

          {/* Expanded details */}
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span>Lost {(moment.cpLoss / 100).toFixed(1)} pawns</span>
            <span>{moment.phase}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate();
              }}
              className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700"
            >
              Go to position
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
