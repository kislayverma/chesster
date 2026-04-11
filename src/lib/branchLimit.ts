/**
 * Anonymous-user stack depth cap (DESIGN.md §12b).
 *
 * The Phase 6 stack-of-forks model replaces the old "persistent
 * siblings" branching with a linear stack of exploration frames.
 * While the user isn't signed in we cap the number of exploration
 * frames that can sit on top of the mainline — going deeper requires
 * popping the stack first. Mainline itself (frame 0) is never counted
 * or capped.
 */

import type { GameTree } from '../game/gameTree';
import { stackDepth } from '../game/gameTree';

/** Hard cap on exploration frames above the mainline for anonymous users. */
export const MAX_ANON_BRANCHES = 3;

/**
 * Number of exploration frames currently sitting on the stack above
 * the mainline. Named `countExplorationBranches` for continuity with
 * the pre-Phase-6 call sites — the semantic meaning "how many
 * branches has the user opened" is preserved.
 */
export function countExplorationBranches(tree: GameTree): number {
  return stackDepth(tree);
}
