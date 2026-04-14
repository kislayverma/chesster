/**
 * Phase 4 CoachPanel.
 *
 * Reads the last-move coaching snapshot from the game store and
 * renders:
 *   • a quality badge (best/excellent/.../blunder)
 *   • a row of motif chips (one per rule-detected motif)
 *   • the template prose
 *   • a "Try this line" button that forks at the current move's
 *     parent and plays the engine's bestMove in a new branch
 *
 * When no move has been played yet, or the move was classified as
 * "best"/"excellent"/"good", the panel still renders but the Try-this
 * button hides (there's nothing better to try).
 */

import { useGameStore } from '../game/gameStore';
import { QUALITY_COLORS, QUALITY_LABELS } from '../game/moveClassifier';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';

export default function CoachPanel() {
  const quality = useGameStore((s) => s.lastMoveQuality);
  const motifs = useGameStore((s) => s.lastMoveMotifs);
  const coachText = useGameStore((s) => s.lastMoveCoachText);
  const coachSource = useGameStore((s) => s.lastMoveCoachSource);
  const bestMoveBefore = useGameStore((s) => s.lastMoveBestMoveBefore);
  const thinking = useGameStore((s) => s.thinking);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const historyLength = useGameStore((s) => s.history.length);
  const tryThisLine = useGameStore((s) => s.tryThisLine);

  const showTryThis =
    !isGameOver &&
    !!bestMoveBefore &&
    (quality === 'inaccuracy' || quality === 'mistake' || quality === 'blunder');

  if (historyLength === 0) {
    return (
      <div className="rounded border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Coach</h2>
        Play a move to see feedback here.
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Coach</h2>
        {coachSource && (
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            {coachSource}
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {quality ? (
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${QUALITY_COLORS[quality]}`}
          >
            {QUALITY_LABELS[quality]}
          </span>
        ) : thinking ? (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            Analyzing…
          </span>
        ) : null}

        {motifs.map((m) => (
          <span
            key={m}
            className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
            title={m}
          >
            {MOTIF_LABELS[m as MotifId] ?? m}
          </span>
        ))}
      </div>

      <p className="text-sm leading-relaxed text-slate-200">
        {coachText ?? (thinking ? 'Coach is thinking…' : '—')}
      </p>

      {showTryThis && (
        <button
          type="button"
          onClick={tryThisLine}
          className="mt-3 w-full rounded bg-amber-700/60 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-700"
          title="Fork at the previous position and play the engine's top move instead"
        >
          Try this move
        </button>
      )}
    </div>
  );
}
