/**
 * Phase 6 Practice page.
 *
 * Shows due SRS cards one at a time. The board renders `card.fen`
 * and the player must find the engine's `bestMove`. On drop we
 * validate via chess.js, compare to the stored answer, apply an
 * SM-2 review, and advance.
 *
 * When no cards are due the page shows an empty state nudging
 * the user back to Play.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'react-chessboard/dist/chessboard/types';
import { NavLink } from 'react-router-dom';
import { usePracticeStore } from '../srs/practiceStore';
import type { PracticeCard } from '../srs/types';

// ---- helpers ----------------------------------------------------------------

function orientationFromFen(fen: string): 'white' | 'black' {
  const turn = fen.split(' ')[1];
  return turn === 'b' ? 'black' : 'white';
}

/** Normalise SAN by stripping check/checkmate symbols for comparison. */
function normaliseSan(san: string): string {
  return san.replace(/[+#]/g, '');
}

// ---- types ------------------------------------------------------------------

type Phase = 'presenting' | 'correct' | 'incorrect' | 'done';

// ---- component --------------------------------------------------------------

export default function PracticePage() {
  const hydrated = usePracticeStore((s) => s.hydrated);
  const cards = usePracticeStore((s) => s.cards);
  const reviewCard = usePracticeStore((s) => s.reviewCard);

  // Snapshot due cards once when the page opens (or when hydration
  // completes). This prevents the list from shifting under the user
  // as reviews push cards into the future.
  const [sessionCards, setSessionCards] = useState<PracticeCard[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (hydrated && !initialized) {
      const now = Date.now();
      const due = cards
        .filter((c) => c.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt)
        .slice(0, 20);
      setSessionCards(due);
      setInitialized(true);
    }
  }, [hydrated, initialized, cards]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('presenting');
  const [stats, setStats] = useState({ correct: 0, incorrect: 0 });
  const [playerMoveSan, setPlayerMoveSan] = useState<string | null>(null);

  const card = currentIndex < sessionCards.length ? sessionCards[currentIndex] : null;

  // chess.js instance for validating moves on the current card.
  const chess = useMemo(() => {
    if (!card) return null;
    try {
      return new Chess(card.fen);
    } catch {
      return null;
    }
  }, [card]);

  const orientation = card ? orientationFromFen(card.fen) : 'white';

  const onPieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (phase !== 'presenting' || !chess || !card) return false;

      // Attempt the move (auto-queen promotions for now).
      const move = chess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });
      if (!move) return false;

      setPlayerMoveSan(move.san);

      const isCorrect =
        normaliseSan(move.san) === normaliseSan(card.bestMove);

      reviewCard(card.id, isCorrect);

      if (isCorrect) {
        setPhase('correct');
        setStats((s) => ({ ...s, correct: s.correct + 1 }));
      } else {
        setPhase('incorrect');
        setStats((s) => ({ ...s, incorrect: s.incorrect + 1 }));
      }

      return true;
    },
    [phase, chess, card, reviewCard],
  );

  const advance = useCallback(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= sessionCards.length) {
      setPhase('done');
    } else {
      setCurrentIndex(nextIdx);
      setPhase('presenting');
      setPlayerMoveSan(null);
    }
  }, [currentIndex, sessionCards.length]);

  // ---- Arrow overlay for "correct move" hint on incorrect answer ----------

  const correctArrow = useMemo(() => {
    if (phase !== 'incorrect' || !card || !card.fen) return [];
    // Parse bestMove SAN into from/to via a disposable Chess instance.
    try {
      const tmp = new Chess(card.fen);
      const m = tmp.move(card.bestMove);
      if (m) return [[m.from as Square, m.to as Square, 'rgb(34,197,94)']]; // green
    } catch {
      /* ignore parse failures */
    }
    return [];
  }, [phase, card]);

  // ---- Loading / empty states -----------------------------------------------

  if (!hydrated || !initialized) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <span className="text-sm text-slate-400">Loading drills…</span>
      </main>
    );
  }

  if (sessionCards.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <h2 className="text-lg font-semibold text-slate-200">
          No drills due
        </h2>
        <p className="max-w-sm text-center text-sm text-slate-400">
          Play more games to build practice cards from your mistakes.
          Cards are generated automatically whenever the coach detects
          an inaccuracy, mistake, or blunder.
        </p>
        <NavLink
          to="/"
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-500"
        >
          Play a game
        </NavLink>
      </main>
    );
  }

  // ---- Done screen ----------------------------------------------------------

  if (phase === 'done') {
    const total = stats.correct + stats.incorrect;
    const pct = total > 0 ? Math.round((stats.correct / total) * 100) : 0;
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <h2 className="text-lg font-semibold text-slate-200">
          Session complete
        </h2>
        <div className="flex gap-6 text-sm">
          <span className="text-emerald-400">{stats.correct} correct</span>
          <span className="text-red-400">{stats.incorrect} incorrect</span>
          <span className="text-slate-400">{pct}% accuracy</span>
        </div>
        <div className="mt-2 flex gap-3">
          <NavLink
            to="/"
            className="rounded bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Play a game
          </NavLink>
          <button
            type="button"
            onClick={() => {
              // Restart with a fresh snapshot.
              const now = Date.now();
              const due = usePracticeStore
                .getState()
                .cards.filter((c) => c.dueAt <= now)
                .sort((a, b) => a.dueAt - b.dueAt)
                .slice(0, 20);
              setSessionCards(due);
              setCurrentIndex(0);
              setPhase(due.length > 0 ? 'presenting' : 'done');
              setStats({ correct: 0, incorrect: 0 });
              setPlayerMoveSan(null);
            }}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-500"
          >
            More drills
          </button>
        </div>
      </main>
    );
  }

  // ---- Drill view -----------------------------------------------------------

  const progress = `${currentIndex + 1} / ${sessionCards.length}`;
  const fen = phase === 'presenting' ? card!.fen : (chess?.fen() ?? card!.fen);

  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-6">
      {/* Header */}
      <div className="flex w-full max-w-[480px] items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Practice drills
        </h2>
        <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400">
          {progress}
        </span>
      </div>

      {/* Prompt */}
      <p className="text-sm text-slate-300">
        {phase === 'presenting'
          ? `Find the best move for ${orientation}.`
          : phase === 'correct'
            ? 'Correct!'
            : `Incorrect — you played ${playerMoveSan ?? '?'}.`}
      </p>

      {/* Board */}
      <div className="w-full max-w-[480px] aspect-square">
        <Chessboard
          position={fen}
          boardOrientation={orientation}
          onPieceDrop={onPieceDrop}
          arePiecesDraggable={phase === 'presenting'}
          customArrows={correctArrow as never}
          customBoardStyle={{
            borderRadius: '8px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          }}
          animationDuration={150}
        />
      </div>

      {/* Feedback panel */}
      {phase !== 'presenting' && (
        <div className="flex flex-col items-center gap-3">
          {phase === 'correct' && (
            <span className="rounded bg-emerald-900/40 px-3 py-1 text-sm text-emerald-300">
              {card!.bestMove} — nice recall!
            </span>
          )}
          {phase === 'incorrect' && (
            <span className="rounded bg-red-900/40 px-3 py-1 text-sm text-red-300">
              Best move was <strong>{card!.bestMove}</strong> (shown in
              green).
            </span>
          )}

          {card!.motifs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {card!.motifs.map((m) => (
                <span
                  key={m}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                >
                  {m}
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={advance}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-500"
          >
            {currentIndex + 1 < sessionCards.length ? 'Next' : 'Finish'}
          </button>
        </div>
      )}
    </main>
  );
}
