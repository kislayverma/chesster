/**
 * Play page — the live chess board, coach panel, and move list.
 *
 * Phase 5 routing split: the page-level chrome (nav + LLM badge) now
 * lives in `NavShell`, so this module only owns the Play view itself.
 * Content is a direct carryover from Phase 4 `App.tsx`.
 */

import { useCallback, useEffect } from 'react';
import Board from '../components/Board';
import CoachPanel from '../components/CoachPanel';
import EvalBar from '../components/EvalBar';
import MoveList from '../components/MoveList';
import PracticePrompt from '../components/PracticePrompt';
import StackPanel from '../components/StackPanel';
import { useGameStore } from '../game/gameStore';
import { exportPgn } from '../game/pgn';

export default function PlayPage() {
  const turn = useGameStore((s) => s.turn);
  const inCheck = useGameStore((s) => s.inCheck);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const result = useGameStore((s) => s.result);
  const reset = useGameStore((s) => s.reset);
  const undo = useGameStore((s) => s.undo);
  const goBack = useGameStore((s) => s.goBack);
  const goForward = useGameStore((s) => s.goForward);
  const historyLength = useGameStore((s) => s.history.length);
  const currentNodeId = useGameStore((s) => s.currentNodeId);

  const tree = useGameStore((s) => s.tree);
  const humanColor = useGameStore((s) => s.humanColor);
  const skillLevel = useGameStore((s) => s.skillLevel);
  const thinking = useGameStore((s) => s.thinking);
  const setHumanColor = useGameStore((s) => s.setHumanColor);
  const setSkillLevel = useGameStore((s) => s.setSkillLevel);

  const statusLine = isGameOver
    ? result
      ? `Game over · ${result}`
      : 'Game over'
    : `${turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' · check' : ''}${
        thinking ? ' · Stockfish thinking…' : ''
      }`;

  // Check if forward navigation is possible (current node has children).
  const canGoForward = tree.nodes.get(currentNodeId)?.childrenIds.length ?? 0 > 0;

  const boardOrientation: 'white' | 'black' =
    humanColor === 'w' ? 'white' : 'black';

  // Keyboard shortcuts: left/right arrow keys for navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in an input/textarea.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goBack, goForward]);

  const copyPgn = useCallback(async () => {
    const pgn = exportPgn(tree, { humanColor });
    try {
      await navigator.clipboard.writeText(pgn);
    } catch {
      // Fallback for browsers that block clipboard API.
      const ta = document.createElement('textarea');
      ta.value = pgn;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }, [tree, humanColor]);

  return (
    <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[auto_auto_320px]">
      <section className="flex flex-col items-center gap-4">
        <PracticePrompt />
        <div className="flex items-start gap-4">
          <EvalBar orientation={boardOrientation} />
          <div className="w-[480px] max-w-[calc(100vw-8rem)]">
            <Board orientation={boardOrientation} />
          </div>
        </div>

        <div className="flex w-[480px] max-w-[calc(100vw-8rem)] flex-wrap items-center justify-center gap-3 text-sm">
          <span className="truncate rounded bg-slate-800 px-3 py-1 text-center text-slate-300">
            {statusLine}
          </span>

          {/* Navigation: back / forward */}
          <button
            type="button"
            onClick={goBack}
            disabled={historyLength === 0}
            title="Previous move (Left arrow)"
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            &larr;
          </button>
          <button
            type="button"
            onClick={goForward}
            disabled={!canGoForward}
            title="Next move (Right arrow)"
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            &rarr;
          </button>

          <button
            type="button"
            onClick={undo}
            disabled={historyLength === 0}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700"
          >
            New game
          </button>
          <button
            type="button"
            onClick={copyPgn}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700"
          >
            Copy PGN
          </button>
        </div>
      </section>

      <aside className="flex flex-col gap-4 lg:w-64">
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Game settings
          </h2>

          <div>
            <div className="mb-1 text-xs text-slate-400">Play as</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setHumanColor('w')}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  humanColor === 'w'
                    ? 'bg-slate-200 text-slate-900'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                White
              </button>
              <button
                type="button"
                onClick={() => setHumanColor('b')}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  humanColor === 'b'
                    ? 'bg-slate-200 text-slate-900'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Black
              </button>
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>AI skill level</span>
              <span className="font-mono tabular-nums text-slate-200">
                {skillLevel}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={skillLevel}
              onChange={(e) => setSkillLevel(parseInt(e.target.value, 10))}
              className="w-full accent-slate-400"
            />
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>0</span>
              <span>20</span>
            </div>
          </div>
        </div>

        <CoachPanel />

        <div className="min-h-[240px] flex-1">
          <MoveList />
        </div>
      </aside>

      <div className="lg:w-[320px]">
        <StackPanel />
      </div>
    </main>
  );
}
