/**
 * Anonymous-user branch cap (DESIGN.md §12b).
 *
 * While the user isn't signed in we don't want them creating an
 * unbounded forest of exploration branches — it bloats memory, makes
 * the MoveList unreadable, and encourages one-shot throwaway usage.
 * Cap the number of exploration branches rooted directly on the
 * mainline; signed-in users have no limit.
 *
 * "Exploration branches rooted on the mainline" means: walk the
 * mainline, and for each mainline node count how many of its
 * non-first-child descendants exist. Branches nested inside branches
 * don't count toward the cap — this is intentional, it keeps the
 * meaningful unit "how many alternative lines has the user started
 * from the real game".
 */

import type { GameTree } from '../game/gameTree';
import { walkMainline } from '../game/gameTree';

/** Hard cap on exploration branches for anonymous users. */
export const MAX_ANON_BRANCHES = 3;

/**
 * Count exploration branches rooted on the mainline. Each non-first
 * child of a mainline node is one branch (regardless of how deep
 * that branch goes).
 */
export function countExplorationBranches(tree: GameTree): number {
  let count = 0;
  for (const node of walkMainline(tree)) {
    // childrenIds[0] is the mainline continuation; anything beyond
    // that is a branch root.
    if (node.childrenIds.length > 1) {
      count += node.childrenIds.length - 1;
    }
  }
  return count;
}
