/**
 * Phase 4 MoveList.
 *
 * Two-section layout:
 *
 *   1. Main game — the mainline chain (first-child walk from root),
 *      rendered as a two-column white/black grid like Phase 3.
 *
 *   2. Branches — for each exploration branch rooted on the mainline,
 *      a labelled block showing "from <n>. <san>: …" followed by the
 *      branch's moves. Sub-branches of branches are not listed in the
 *      Phase 4 UI (the tree still stores them; they're reachable by
 *      navigating into the branch and forking again).
 *
 * All moves are clickable and call `goToNode` to jump the board.
 * The current node is highlighted.
 */

import { Fragment } from 'react';
import { useGameStore } from '../game/gameStore';
import {
  getNode,
  walkMainline,
  type MoveNode,
} from '../game/gameTree';

interface BranchDescriptor {
  /** The branch's root node (the move that diverged from mainline). */
  rootNode: MoveNode;
  /** Full-move number where the branch diverged (on the mainline parent). */
  branchFromFullmove: number;
  /** Which side moved at the divergence point ('w' or 'b'). */
  branchFromColor: 'w' | 'b';
  /** The branch's chain (first-child walk starting at rootNode). */
  chain: MoveNode[];
}

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

  // ---- Branches rooted on the mainline ----
  const branches: BranchDescriptor[] = [];
  for (const node of walkMainline(tree)) {
    if (node.childrenIds.length <= 1) continue;
    for (let i = 1; i < node.childrenIds.length; i++) {
      const rootNode = getNode(tree, node.childrenIds[i]);
      // Walk chain
      const chain: MoveNode[] = [];
      let cur: MoveNode | undefined = rootNode;
      while (cur) {
        chain.push(cur);
        const nextId: string | undefined = cur.childrenIds[0];
        cur = nextId ? tree.nodes.get(nextId) : undefined;
      }
      branches.push({
        rootNode,
        branchFromFullmove: Math.ceil(node.ply / 2) || 1,
        branchFromColor: (node.moverColor ?? 'w') as 'w' | 'b',
        chain,
      });
    }
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

      {/* Branches */}
      {branches.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-500/70">
            Branches
          </h3>
          <ol className="space-y-2 font-mono text-xs">
            {branches.map((b, idx) => {
              const prefix =
                b.branchFromColor === 'w'
                  ? `${b.branchFromFullmove}…`
                  : `${b.branchFromFullmove + 1}.`;
              return (
                <li
                  key={b.rootNode.id}
                  className="rounded border-l-2 border-amber-600/50 pl-2"
                >
                  <div className="mb-0.5 text-[10px] text-slate-500">
                    Branch {idx + 1} · from {prefix}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {b.chain.map((node) => (
                      <Fragment key={node.id}>
                        {node.moverColor === 'w' && (
                          <span className="text-slate-600">
                            {Math.ceil(node.ply / 2)}.
                          </span>
                        )}
                        <button
                          type="button"
                          className={moveButtonClass(node.id)}
                          onClick={() => goToNode(node.id)}
                        >
                          {node.move}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
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
