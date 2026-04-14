/**
 * Play page — the live chess board, coach panel, and move list.
 *
 * Phase 5 routing split: the page-level chrome (nav + LLM badge) now
 * lives in `NavShell`, so this module only owns the Play view itself.
 * Content is a direct carryover from Phase 4 `App.tsx`.
 */

import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import Board from '../components/Board';
import CoachPanel from '../components/CoachPanel';
import MoveList from '../components/MoveList';
import PracticePrompt from '../components/PracticePrompt';
import StackPanel from '../components/StackPanel';
import { useGameStore } from '../game/gameStore';

export default function PlayPage() {
  const turn = useGameStore((s) => s.turn);
  const inCheck = useGameStore((s) => s.inCheck);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const result = useGameStore((s) => s.result);
  const treeResult = useGameStore((s) => s.tree.result);
  const reset = useGameStore((s) => s.reset);
  const resign = useGameStore((s) => s.resign);
  const goBack = useGameStore((s) => s.goBack);
  const goForward = useGameStore((s) => s.goForward);
  const historyLength = useGameStore((s) => s.history.length);
  const currentNodeId = useGameStore((s) => s.currentNodeId);

  const tree = useGameStore((s) => s.tree);
  const humanColor = useGameStore((s) => s.humanColor);
  const skillLevel = useGameStore((s) => s.skillLevel);
  const branchCapReached = useGameStore((s) => s.branchCapReached);

  const setHumanColor = useGameStore((s) => s.setHumanColor);
  const setSkillLevel = useGameStore((s) => s.setSkillLevel);

  // The game is finished when tree.result is set (covers endings on any
  // branch) or when the current position itself is game-over.
  const gameFinished = !!treeResult || isGameOver;
  const displayResult = treeResult ?? result;

  const statusLine = gameFinished
    ? displayResult
      ? `Game over · ${displayResult}`
      : 'Game over'
    : `${turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' · check' : ''}`;

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

  return (
    <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:gap-6 lg:p-6 lg:grid-cols-[auto_auto_320px]">
      {/* Column 1: Board + controls */}
      <section className="flex flex-col items-center gap-3 lg:gap-4">
        <PracticePrompt />

        {branchCapReached && (
          <div
            role="alert"
            className="w-full max-w-[480px] rounded border border-amber-500/60 bg-amber-900/30 px-3 py-2 text-xs text-amber-100"
          >
            Branch limit reached.{' '}
            <NavLink to="/login" className="underline underline-offset-2 hover:text-amber-50">
              Sign in
            </NavLink>{' '}
            for unlimited branches.
          </div>
        )}

        <div className="w-full max-w-[480px]">
          <Board orientation={boardOrientation} />
        </div>

        {/* Controls — right under the board */}
        <div className="flex w-full max-w-[480px] flex-wrap items-center justify-center gap-2 text-xs lg:gap-3 lg:text-sm">
          <span className="truncate rounded bg-slate-800 px-2 py-1 text-center text-slate-300 lg:px-3">
            {statusLine}
          </span>

          {/* Navigation: back / forward */}
          <button
            type="button"
            onClick={goBack}
            disabled={historyLength === 0}
            title="Previous move (Left arrow)"
            className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 lg:px-3"
          >
            &larr;
          </button>
          <button
            type="button"
            onClick={goForward}
            disabled={!canGoForward}
            title="Next move (Right arrow)"
            className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 lg:px-3"
          >
            &rarr;
          </button>

          {!gameFinished && historyLength > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Resign this game?')) resign();
              }}
              className="rounded bg-rose-900/60 px-2 py-1 text-rose-200 hover:bg-rose-800/60 lg:px-3"
            >
              Resign
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700 lg:px-3"
          >
            New game
          </button>
        </div>

        {/* Coach panel — visible after controls on mobile, hidden on desktop (shown in sidebar) */}
        <div className="w-full max-w-[480px] lg:hidden">
          <CoachPanel />
        </div>

        {/* Stack panel — after coach on mobile, moves to column 3 on desktop */}
        <div className="w-full max-w-[480px] lg:hidden">
          <StackPanel />
        </div>
      </section>

      {/* Column 2: Settings + Coach (desktop) + Moves */}
      <aside className="flex flex-col gap-3 lg:gap-4 lg:w-64">
        {!gameFinished && (
          <div className="rounded border border-slate-800 bg-slate-900/40 p-3 lg:p-4">
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
        )}

        {/* Coach panel — desktop only (mobile version is above, right after board) */}
        <div className="hidden lg:block">
          <CoachPanel />
        </div>

        <div className="min-h-[240px] flex-1">
          <MoveList />
        </div>
      </aside>

      {/* Column 3: Stack panel — desktop only (mobile version is inline after coach) */}
      <div className="hidden lg:block lg:w-[320px]">
        <StackPanel />
      </div>
    </main>
  );
}
