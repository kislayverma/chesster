/**
 * StackPanel — exploration stack rendered as decision cards.
 *
 * Replaces the old technical "Stack" viewer with a friendlier UX:
 *   - "Your game" instead of "Mainline"
 *   - Contextual branch labels ("You tried: Nf3" instead of "Branch 1")
 *   - Move number and fork context ("Move 5 · You played Nc3")
 *   - Eval delta indicators (green/red) when engine data is available
 *   - "Back to your game" escape hatch when exploring a branch
 *   - Indigo accent for mainline, eval-tinted accents for branches
 */

import { useGameStore } from '../game/gameStore';
import type { GameTree, StackFrame } from '../game/gameTree';
import { getBranchCap } from '../lib/branchLimit';
import MiniBoard from './MiniBoard';

interface FramePreview {
  frame: StackFrame;
  moveCount: number;
  tipFen: string | null;
  /** SAN of the first move in this branch (the "tried" move). */
  branchMove: string | null;
  /** Move number where the fork occurred (e.g. 5 for ply 9 or 10). */
  forkMoveNumber: number | null;
  /** SAN of the mainline continuation at the fork point. */
  mainlineMove: string | null;
  /** Eval delta in centipawns (branch eval − mainline eval), white-relative. */
  evalDelta: number | null;
}

function buildPreview(tree: GameTree, frame: StackFrame): FramePreview {
  const moveCount =
    frame.index === 0
      ? Math.max(0, frame.nodeIds.length - 1) // minus synthetic root
      : frame.nodeIds.length;
  const tipId = frame.nodeIds[frame.nodeIds.length - 1];
  const tipFen = tipId ? tree.nodes.get(tipId)?.fen ?? null : null;

  let branchMove: string | null = null;
  let forkMoveNumber: number | null = null;
  let mainlineMove: string | null = null;
  let evalDelta: number | null = null;

  if (frame.index > 0 && frame.forkPointNodeId) {
    const forkNode = tree.nodes.get(frame.forkPointNodeId);

    // The branch's first move.
    const branchFirstId = frame.nodeIds[0];
    const branchFirstNode = branchFirstId
      ? tree.nodes.get(branchFirstId)
      : undefined;
    if (branchFirstNode) {
      branchMove = branchFirstNode.move || null;
    }

    // Move number at the fork point.
    if (forkNode) {
      forkMoveNumber = Math.ceil((forkNode.ply + 1) / 2);
    }

    // Find the mainline continuation at the fork point — the first
    // child of the fork node that belongs to the parent frame.
    if (forkNode) {
      const parentFrame = tree.stackFrames.find(
        (f) => f.id === frame.parentFrameId,
      );
      if (parentFrame) {
        const forkIdx = parentFrame.nodeIds.indexOf(frame.forkPointNodeId!);
        if (forkIdx >= 0 && forkIdx + 1 < parentFrame.nodeIds.length) {
          const mainNextId = parentFrame.nodeIds[forkIdx + 1];
          const mainNextNode = mainNextId
            ? tree.nodes.get(mainNextId)
            : undefined;
          if (mainNextNode) {
            mainlineMove = mainNextNode.move || null;

            // Eval delta: compare branch first move to mainline continuation.
            if (
              branchFirstNode?.evalCp != null &&
              mainNextNode.evalCp != null
            ) {
              evalDelta = branchFirstNode.evalCp - mainNextNode.evalCp;
            }
          }
        }
      }
    }
  }

  return {
    frame,
    moveCount,
    tipFen,
    branchMove,
    forkMoveNumber,
    mainlineMove,
    evalDelta,
  };
}

/** Human-friendly label for a branch frame. */
function branchLabel(preview: FramePreview): string {
  const { branchMove, forkMoveNumber } = preview;
  const prefix = forkMoveNumber != null ? `Move ${forkMoveNumber}` : null;
  const tried = branchMove ? `You tried: ${branchMove}` : 'Exploration';
  return prefix ? `${prefix} · ${tried}` : tried;
}

/** Small colored badge showing eval delta. */
function EvalDeltaBadge({ delta }: { delta: number }) {
  // Positive = branch is better for white; negative = worse.
  const isBetter = delta > 0;
  const absVal = Math.abs(delta);
  const display =
    absVal >= 100
      ? `${(absVal / 100).toFixed(1)}`
      : `0.${String(absVal).padStart(2, '0')}`;

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
        isBetter
          ? 'bg-emerald-900/40 text-emerald-300'
          : 'bg-rose-900/40 text-rose-300'
      }`}
      title={`${isBetter ? '+' : ''}${(delta / 100).toFixed(2)} eval (white perspective)`}
    >
      {isBetter ? '+' : '-'}{display}
    </span>
  );
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
  const cap = getBranchCap();
  const capReached = depth >= cap;

  const mainlineFrameId = stackFrames[0]?.id;
  const isOnBranch = currentFrameId !== mainlineFrameId;

  return (
    <div className="flex h-full flex-col rounded-lg bg-slate-900 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Explorations
        </h2>
        {depth > 0 && (
          <span
            className={`text-[11px] tabular-nums ${
              capReached ? 'text-amber-400' : 'text-slate-500'
            }`}
            title="Exploration branches"
          >
            {Number.isFinite(cap) ? `${depth}/${cap}` : `${depth}`}
          </span>
        )}
      </div>

      {/* "Back to your game" escape hatch */}
      {isOnBranch && mainlineFrameId && (
        <button
          type="button"
          onClick={() => popToFrame(mainlineFrameId)}
          className="mb-3 flex items-center gap-1.5 rounded border border-indigo-500/40 bg-indigo-900/20 px-3 py-1.5 text-xs font-medium text-indigo-200 transition-colors hover:bg-indigo-900/40"
        >
          <span aria-hidden="true">&larr;</span>
          Back to your game
        </button>
      )}

      <ol className="flex flex-col gap-3 text-sm">
        {ordered.map((frame) => {
          const preview = buildPreview(tree, frame);
          const isCurrent = frame.id === currentFrameId;
          const isMainline = frame.index === 0;

          // Border accent based on frame type and eval.
          let borderClass: string;
          let bgClass: string;
          if (isCurrent) {
            borderClass = 'border-amber-500/70';
            bgClass = 'bg-amber-900/20';
          } else if (isMainline) {
            borderClass = 'border-indigo-500/40';
            bgClass = 'bg-indigo-900/10 hover:border-indigo-400/60 hover:bg-indigo-900/20';
          } else if (preview.evalDelta != null && preview.evalDelta > 0) {
            borderClass = 'border-emerald-600/40';
            bgClass = 'bg-emerald-900/10 hover:border-emerald-500/60 hover:bg-emerald-900/20';
          } else if (preview.evalDelta != null && preview.evalDelta < 0) {
            borderClass = 'border-rose-600/40';
            bgClass = 'bg-rose-900/10 hover:border-rose-500/60 hover:bg-rose-900/20';
          } else {
            borderClass = 'border-slate-800';
            bgClass = 'bg-slate-900/40 hover:border-slate-600 hover:bg-slate-800/80';
          }

          return (
            <li key={frame.id}>
              <button
                type="button"
                onClick={() => popToFrame(frame.id)}
                className={`flex w-full flex-col gap-2 rounded border p-2 text-left transition-colors ${borderClass} ${bgClass}`}
                title={
                  isMainline
                    ? 'Return to your game.'
                    : 'Jump to this exploration.'
                }
              >
                {/* Header row: label + move count */}
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      isCurrent ? 'text-amber-100' : isMainline ? 'text-indigo-100' : 'text-slate-200'
                    }`}
                  >
                    {isMainline ? 'Your game' : branchLabel(preview)}
                  </span>
                  <div className="flex items-center gap-2">
                    {!isMainline && preview.evalDelta != null && (
                      <EvalDeltaBadge delta={preview.evalDelta} />
                    )}
                    <span className="text-[10px] tabular-nums text-slate-500">
                      {preview.moveCount}{' '}
                      {preview.moveCount === 1 ? 'move' : 'moves'}
                    </span>
                  </div>
                </div>

                {/* Fork context: "You played X · Instead: Y" */}
                {!isMainline && preview.mainlineMove && preview.branchMove && (
                  <div className="text-[11px] leading-snug text-slate-400">
                    You played{' '}
                    <span className="font-mono text-slate-300">
                      {preview.mainlineMove}
                    </span>
                    {' · Instead: '}
                    <span className="font-mono text-slate-200">
                      {preview.branchMove}
                    </span>
                  </div>
                )}

                {/* Mini board preview */}
                {preview.tipFen ? (
                  <MiniBoard
                    fen={preview.tipFen}
                    orientation={boardOrientation}
                  />
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
        Tap any exploration to jump there. Your game is always safe.
      </p>
    </div>
  );
}
