/**
 * Phase 4 ForkBanner.
 *
 * Renders a small yellow banner above the board whenever the user is
 * inside an exploration branch (i.e. `explorationRootId != null`). It
 * offers a "Return to main game" button that snaps the board back to
 * the real game's head without deleting the branch — all branches
 * are preserved in the tree and remain navigable from the MoveList.
 *
 * The banner also acts as the user's primary signal that moves they
 * play here are "what-if" moves, not part of the real game.
 */

import { useGameStore } from '../game/gameStore';

export default function ForkBanner() {
  const explorationRootId = useGameStore((s) => s.explorationRootId);
  const returnToMainGame = useGameStore((s) => s.returnToMainGame);
  const forkBlockedReason = useGameStore((s) => s.forkBlockedReason);

  if (forkBlockedReason) {
    return (
      <div className="w-full rounded border border-red-700/60 bg-red-900/40 px-3 py-2 text-xs text-red-200">
        {forkBlockedReason}
      </div>
    );
  }

  if (!explorationRootId) return null;

  return (
    <div className="flex w-full items-center justify-between gap-3 rounded border border-amber-600/50 bg-amber-900/30 px-3 py-2 text-xs text-amber-100">
      <span>
        <span className="font-semibold">Exploration branch.</span>{' '}
        Moves played here don't affect your real game.
      </span>
      <button
        type="button"
        onClick={returnToMainGame}
        className="rounded bg-amber-700/60 px-2 py-1 text-[11px] font-medium text-amber-50 hover:bg-amber-700"
      >
        Return to main game
      </button>
    </div>
  );
}
