/**
 * Phase 6 StackPanel.
 *
 * Renders the exploration stack in the right-hand column of the Play
 * page. Frame 0 is the mainline (always at the bottom, permanent);
 * frames above are exploration branches the player pushed by making
 * moves from non-tip positions.
 *
 * Each frame is previewed as a small read-only board (MiniBoard)
 * showing its *tip* position — i.e. the latest move inside that
 * frame. Clicking a frame pops every frame above it off the stack
 * and snaps the live board to the target frame's tip (see
 * `popToFrameId` in gameTree.ts). The stack is visualized top-down
 * so the most recent push is at the top — where the player's
 * attention is.
 */

import { useGameStore } from '../game/gameStore';
import type { GameTree, StackFrame } from '../game/gameTree';
import { MAX_ANON_BRANCHES } from '../lib/branchLimit';
import MiniBoard from './MiniBoard';

interface FramePreview {
  frame: StackFrame;
  moveCount: number;
  tipFen: string | null;
}

function buildPreview(tree: GameTree, frame: StackFrame): FramePreview {
  const moveCount = frame.index === 0
    ? Math.max(0, frame.nodeIds.length - 1) // minus synthetic root
    : frame.nodeIds.length;
  const tipId = frame.nodeIds[frame.nodeIds.length - 1];
  const tipFen = tipId ? tree.nodes.get(tipId)?.fen ?? null : null;
  return { frame, moveCount, tipFen };
}

export default function StackPanel() {
  const tree = useGameStore((s) => s.tree);
  const stackFrames = useGameStore((s) => s.stackFrames);
  const currentFrameId = useGameStore((s) => s.currentFrameId);
  const humanColor = useGameStore((s) => s.humanColor);
  const popToFrame = useGameStore((s) => s.popToFrame);

  const boardOrientation: 'white' | 'black' =
    humanColor === 'w' ? 'white' : 'black';

  // Render top-of-stack first (reverse of push order).
  const ordered = [...stackFrames].reverse();
  const depth = Math.max(0, stackFrames.length - 1);
  const capReached = depth >= MAX_ANON_BRANCHES;

  return (
    <div className="flex h-full flex-col rounded-lg bg-slate-900 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Stack
        </h2>
        <span
          className={`text-[11px] tabular-nums ${
            capReached ? 'text-amber-400' : 'text-slate-500'
          }`}
          title="Exploration frames on top of the mainline"
        >
          {depth}/{MAX_ANON_BRANCHES}
        </span>
      </div>

      <ol className="flex flex-col gap-3 text-sm">
        {ordered.map((frame) => {
          const preview = buildPreview(tree, frame);
          const isCurrent = frame.id === currentFrameId;
          const isMainline = frame.index === 0;

          return (
            <li key={frame.id}>
              <button
                type="button"
                onClick={() => popToFrame(frame.id)}
                className={`flex w-full flex-col gap-2 rounded border p-2 text-left transition-colors ${
                  isCurrent
                    ? 'border-amber-500/70 bg-amber-900/20'
                    : isMainline
                      ? 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-800/80'
                }`}
                title={
                  isMainline
                    ? 'Pop all branches and return to the mainline head. (Mainline is permanent.)'
                    : 'Discard every frame above this one and return to this branch\u2019s tip.'
                }
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      isCurrent ? 'text-amber-100' : 'text-slate-200'
                    }`}
                  >
                    {frame.label}
                    {isMainline && (
                      <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-slate-500">
                        permanent
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-500">
                    {preview.moveCount} {preview.moveCount === 1 ? 'move' : 'moves'}
                  </span>
                </div>

                {preview.tipFen ? (
                  <MiniBoard fen={preview.tipFen} orientation={boardOrientation} />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded bg-slate-800 text-[10px] text-slate-600">
                    no position
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-[11px] leading-snug text-slate-500">
        Clicking a frame pops everything above it off the stack
        (destructive). Mainline is always kept.
      </p>
    </div>
  );
}
