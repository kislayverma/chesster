/**
 * Play page — the live chess board, coach panel, and move list.
 *
 * Phase 5 routing split: the page-level chrome (nav + LLM badge) now
 * lives in `NavShell`, so this module only owns the Play view itself.
 * Content is a direct carryover from Phase 4 `App.tsx`.
 */

import Board from '../components/Board';
import CoachPanel from '../components/CoachPanel';
import EvalBar from '../components/EvalBar';
import ForkBanner from '../components/ForkBanner';
import MoveList from '../components/MoveList';
import { useGameStore } from '../game/gameStore';

export default function PlayPage() {
  const turn = useGameStore((s) => s.turn);
  const inCheck = useGameStore((s) => s.inCheck);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const result = useGameStore((s) => s.result);
  const reset = useGameStore((s) => s.reset);
  const undo = useGameStore((s) => s.undo);
  const historyLength = useGameStore((s) => s.history.length);

  const engineEnabled = useGameStore((s) => s.engineEnabled);
  const humanColor = useGameStore((s) => s.humanColor);
  const skillLevel = useGameStore((s) => s.skillLevel);
  const thinking = useGameStore((s) => s.thinking);
  const setEngineEnabled = useGameStore((s) => s.setEngineEnabled);
  const setHumanColor = useGameStore((s) => s.setHumanColor);
  const setSkillLevel = useGameStore((s) => s.setSkillLevel);

  const statusLine = isGameOver
    ? result
      ? `Game over · ${result}`
      : 'Game over'
    : `${turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' · check' : ''}${
        thinking ? ' · Stockfish thinking…' : ''
      }`;

  const boardOrientation: 'white' | 'black' =
    humanColor === 'w' ? 'white' : 'black';

  return (
    <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[auto_auto_320px]">
      <section className="flex flex-col items-center gap-4">
        <div className="w-full max-w-[560px]">
          <ForkBanner />
        </div>
        <div className="flex items-start gap-4">
          <EvalBar orientation={boardOrientation} />
          <div className="w-[480px] max-w-[calc(100vw-8rem)]">
            <Board orientation={boardOrientation} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
          <span className="rounded bg-slate-800 px-3 py-1 text-slate-300">
            {statusLine}
          </span>
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
        </div>
      </section>

      <aside className="flex flex-col gap-4 lg:w-64">
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Stockfish
          </h2>

          <label className="flex items-center justify-between gap-2 text-xs text-slate-300">
            <span>Engine opponent</span>
            <input
              type="checkbox"
              checked={engineEnabled}
              onChange={(e) => setEngineEnabled(e.target.checked)}
              className="h-4 w-4 accent-slate-400"
            />
          </label>

          <div className="mt-3">
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
              <span>Skill level</span>
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
    </main>
  );
}
