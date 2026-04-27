/**
 * CoachPanel — in-game coaching feedback.
 *
 * Reads the last-move coaching snapshot from the game store and renders:
 *   - a quality badge with progressive cpLoss disclosure
 *   - a phase tag (opening / middlegame / endgame)
 *   - motif chips with recurring weakness emphasis
 *   - the coach prose
 *   - a "Try this line" button for mistakes/blunders
 */

import { useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { QUALITY_COLORS, QUALITY_LABELS } from '../game/moveClassifier';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import { useProfileStore } from '../profile/profileStore';
import { trackEvent } from '../lib/analytics';

/** Minimum decayedCount to highlight a motif as "recurring". */
const RECURRING_THRESHOLD = 2;

export default function CoachPanel() {
  const quality = useGameStore((s) => s.lastMoveQuality);
  const motifs = useGameStore((s) => s.lastMoveMotifs);
  const coachText = useGameStore((s) => s.lastMoveCoachText);
  const coachSource = useGameStore((s) => s.lastMoveCoachSource);
  const cpLoss = useGameStore((s) => s.lastMoveCpLoss);
  const bestMoveBefore = useGameStore((s) => s.lastMoveBestMoveBefore);
  const thinking = useGameStore((s) => s.thinking);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const treeResult = useGameStore((s) => s.tree.result);
  const historyLength = useGameStore((s) => s.history.length);
  const tryThisLine = useGameStore((s) => s.tryThisLine);
  const coachingPaused = useGameStore((s) => s.coachingPaused);
  const dismissCoachingPause = useGameStore((s) => s.dismissCoachingPause);
  const fen = useGameStore((s) => s.fen);

  // Profile weakness data for recurring motif highlighting
  const motifCounts = useProfileStore((s) => s.profile.motifCounts);

  const [cpExpanded, setCpExpanded] = useState(false);

  const gameFinished = !!treeResult || isGameOver;
  const isBad =
    quality === 'inaccuracy' || quality === 'mistake' || quality === 'blunder';

  const showTryThis = !gameFinished && !!bestMoveBefore && isBad;

  // Detect phase from FEN for the phase tag
  const phase = detectPhaseFromFen(fen);

  // Auto-expand cpLoss for blunders
  const showCp =
    cpLoss != null &&
    cpLoss > 0 &&
    isBad &&
    (cpExpanded || quality === 'blunder');

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
        <div className="flex items-center gap-2">
          {/* Phase tag */}
          {quality && phase && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              {phase}
            </span>
          )}
          {coachSource && (
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {coachSource}
            </span>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Quality badge with progressive cpLoss */}
        {quality ? (
          <button
            type="button"
            onClick={() => {
              if (isBad) {
                const next = !cpExpanded;
                setCpExpanded(next);
                if (next) trackEvent('cp_loss_expanded', { quality });
              }
            }}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${QUALITY_COLORS[quality]} ${isBad ? 'cursor-pointer' : ''}`}
            title={isBad && cpLoss ? `Click to ${cpExpanded ? 'hide' : 'show'} details` : undefined}
          >
            {QUALITY_LABELS[quality]}
            {showCp && (
              <span className="ml-1 font-normal opacity-80">
                {'\u00B7'} {(cpLoss / 100).toFixed(1)} pawns
              </span>
            )}
          </button>
        ) : thinking ? (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            Analyzing...
          </span>
        ) : null}

        {/* Motif chips with recurring emphasis */}
        {motifs.map((m) => {
          const counter = motifCounts[m];
          const isRecurring =
            counter != null && counter.decayedCount >= RECURRING_THRESHOLD;
          return (
            <span
              key={m}
              className={`rounded px-2 py-0.5 text-[11px] ${
                isRecurring
                  ? 'bg-amber-900/50 text-amber-200 ring-1 ring-amber-700/50'
                  : 'bg-slate-800 text-slate-300'
              }`}
              title={
                isRecurring
                  ? `${MOTIF_LABELS[m as MotifId] ?? m} — recurring weakness (${counter.count} times)`
                  : m
              }
            >
              {MOTIF_LABELS[m as MotifId] ?? m}
              {isRecurring && (
                <span className="ml-1 text-[10px] text-amber-400">
                  {counter.count}x
                </span>
              )}
            </span>
          );
        })}
      </div>

      <p className="text-sm leading-relaxed text-slate-200">
        {coachText ?? (thinking ? 'Coach is thinking...' : '\u2014')}
      </p>

      {/* Coaching pause / try-this buttons.
          On mobile (<lg) these are rendered as a fixed footer bar in PlayPage,
          so we only show them here on desktop (hidden lg:block). */}
      {coachingPaused && showTryThis ? (
        <div className="mt-3 hidden gap-2 lg:flex">
          <button
            type="button"
            onClick={() => { trackEvent('coaching_pause_dismissed'); dismissCoachingPause(); }}
            className="flex-1 animate-pulse-ring rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            title="Dismiss and let the engine respond"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={() => { trackEvent('try_this_move_clicked'); tryThisLine(); }}
            className="flex-1 rounded bg-amber-700/60 px-3 py-2 text-sm font-medium text-amber-50 hover:bg-amber-700"
            title="Fork at the previous position and play the engine's top move instead"
          >
            Try this move
          </button>
        </div>
      ) : showTryThis ? (
        <button
          type="button"
          onClick={() => { trackEvent('try_this_move_clicked'); tryThisLine(); }}
          className="mt-3 hidden w-full rounded bg-amber-700/60 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-700 lg:block"
          title="Fork at the previous position and play the engine's top move instead"
        >
          Try this move
        </button>
      ) : coachingPaused ? (
        <button
          type="button"
          onClick={() => { trackEvent('coaching_pause_dismissed'); dismissCoachingPause(); }}
          className="mt-3 hidden w-full animate-pulse-ring rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 lg:block"
          title="Dismiss and let the engine respond"
        >
          Continue
        </button>
      ) : null}
    </div>
  );
}

/**
 * Cheap phase detection from FEN for the phase tag display.
 * Mirrors the logic in tagging/phaseDetector.ts but returns a display string.
 */
function detectPhaseFromFen(fen: string): string | null {
  try {
    const parts = fen.split(/\s+/);
    const board = parts[0] ?? '';
    const fullmove = parseInt(parts[5] ?? '1', 10) || 1;

    let whiteQueens = 0;
    let blackQueens = 0;
    let nonKingNonPawnPieces = 0;
    let nonKingPieces = 0;

    for (const ch of board) {
      if (ch === '/') continue;
      if (ch >= '0' && ch <= '9') continue;
      const upper = ch.toUpperCase();
      if (upper === 'K') continue;
      nonKingPieces += 1;
      if (upper !== 'P') nonKingNonPawnPieces += 1;
      if (ch === 'Q') whiteQueens += 1;
      if (ch === 'q') blackQueens += 1;
    }

    const queensOn = whiteQueens > 0 && blackQueens > 0;
    if (fullmove <= 10 && queensOn) return 'Opening';
    if (nonKingNonPawnPieces <= 6) return 'Endgame';
    if (!queensOn && nonKingPieces <= 10) return 'Endgame';
    return 'Middlegame';
  } catch {
    return null;
  }
}
