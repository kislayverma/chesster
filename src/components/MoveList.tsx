/**
 * Phase 6 MoveList.
 *
 * Renders only the mainline (frame 0). Exploration branches live in
 * the StackPanel now — the Phase 4 "Branches" section is gone since
 * popping is destructive and branches no longer hang around as
 * siblings of the main game.
 *
 * All moves are clickable and call `goToNode` to jump the board.
 * The current node is highlighted.
 */

import { useGameStore } from '../game/gameStore';
import { walkMainline, type MoveNode } from '../game/gameTree';

export default function MoveList() {
  const tree = useGameStore((s) => s.tree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const mainGameHeadId = useGameStore((s) => s.mainGameHeadId);
  const goToNode = useGameStore((s) => s.goToNode);
  const result = useGameStore((s) => s.result);

  // ---- Mainline ----
  const mainline: MoveNode[] = [];
  for (const node of walkMainline(tree)) {
    if (node.parentId !== null) mainline.push(node);
  }

  // Group mainline into full-move rows of {white, black}.
  const rows: Array<{ n: number; white?: MoveNode; black?: MoveNode }> = [];
  for (let i = 0; i < mainline.length; i += 2) {
    rows.push({
      n: Math.floor(i / 2) + 1,
      white: mainline[i],
      black: mainline[i + 1],
    });
  }

  const moveButtonClass = (nodeId: string): string => {
    const base = 'rounded px-1 py-0.5 text-left hover:bg-slate-800';
    if (nodeId === currentNodeId) {
      return `${base} bg-slate-700 text-slate-50 ring-1 ring-amber-500/60`;
    }
    return `${base} text-slate-200`;
  };

  return (
    <div className="flex h-full flex-col rounded-lg bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Moves
      </h2>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No moves yet. Drag a piece to begin.</p>
      ) : (
        <ol className="font-mono text-sm">
          {rows.map((row) => (
            <li
              key={row.n}
              className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2 py-0.5"
            >
              <span className="text-right text-slate-500">{row.n}.</span>
              {row.white ? (
                <button
                  type="button"
                  className={moveButtonClass(row.white.id)}
                  onClick={() => goToNode(row.white!.id)}
                >
                  {row.white.move}
                </button>
              ) : (
                <span />
              )}
              {row.black ? (
                <button
                  type="button"
                  className={moveButtonClass(row.black.id)}
                  onClick={() => goToNode(row.black!.id)}
                >
                  {row.black.move}
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Mainline head marker (so the user knows where "real game" ends) */}
      {mainGameHeadId !== tree.rootId && (
        <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">
          — main game head —
        </div>
      )}

      {result && (
        <div className="mt-3 rounded bg-slate-800 px-3 py-2 text-center text-sm font-semibold text-slate-100">
          Game over · {result}
        </div>
      )}
    </div>
  );
}
