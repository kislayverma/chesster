/**
 * Phase 3 move classifier.
 *
 * Converts a (evalBefore, evalAfter) pair into a `MoveQuality` label
 * using the thresholds in DESIGN.md §5. Evals come in from the store
 * as white-perspective centipawn/mate numbers (see `normalizeEval` in
 * gameStore.ts), and get translated back into the mover's perspective
 * here.
 *
 * Mate scores are coerced into a large sentinel so that losing a
 * forced mate produces a huge positive cpLoss and falls into the
 * blunder bucket naturally. We still special-case the "lost forced
 * mate" check explicitly, per the DESIGN §5 note.
 */

/**
 * DESIGN.md §4.1 MoveQuality. Lives here in Phase 3 and will be
 * re-exported from gameTree.ts once the tree refactor lands in Phase 4.
 */
export type MoveQuality =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'book';

export interface ClassifyInput {
  /** White-perspective centipawn eval BEFORE the player's move, or null if mate. */
  evalBeforeCp: number | null;
  /** White-perspective mate-in-N BEFORE the player's move, or null. */
  evalBeforeMate: number | null;
  /** White-perspective centipawn eval AFTER the player's move, or null if mate. */
  evalAfterCp: number | null;
  /** White-perspective mate-in-N AFTER the player's move, or null. */
  evalAfterMate: number | null;
  /** Which color actually made the move being classified. */
  moverColor: 'w' | 'b';
  /** Set when the position had exactly one legal move — skip classification. */
  onlyLegalMove?: boolean;
}

export interface ClassifyResult {
  quality: MoveQuality | null; // null when classification is skipped
  cpLoss: number;              // mover-perspective centipawns lost (can be negative)
}

/** Sentinel used to fold mate-in-N into a comparable centipawn number. */
const MATE_SCORE = 100_000;
/** Each additional mate distance ply is worth this much "less" than mate in 1. */
const MATE_STEP = 100;

/**
 * Convert a white-perspective eval into a signed centipawn number from
 * the mover's point of view. Mate scores become +/- (MATE_SCORE - N*STEP).
 */
function toMoverCp(
  cp: number | null,
  mate: number | null,
  mover: 'w' | 'b'
): number {
  const sign = mover === 'w' ? 1 : -1;
  if (mate != null) {
    // White mates in +N → +MATE_SCORE - N*STEP (more positive for quicker mate).
    // Black mates in -N → -MATE_SCORE + N*STEP (more negative for quicker mate).
    const whiteScore =
      mate > 0 ? MATE_SCORE - mate * MATE_STEP : -MATE_SCORE - mate * MATE_STEP;
    return whiteScore * sign;
  }
  if (cp != null) return cp * sign;
  return 0;
}

/**
 * Did the mover have a forced mate before the move and lose it with
 * this move? Checked purely against white-perspective mate scores.
 */
function lostForcedMate(input: ClassifyInput): boolean {
  const { evalBeforeMate, evalAfterMate, moverColor } = input;
  if (evalBeforeMate == null) return false;
  const moverWasMating =
    (moverColor === 'w' && evalBeforeMate > 0) ||
    (moverColor === 'b' && evalBeforeMate < 0);
  if (!moverWasMating) return false;
  if (evalAfterMate == null) return true;
  // After the move, side-to-move flipped, so the sign should flip too
  // if the mate is still going. Specifically: if white was mating
  // (+N), after white's move it's black to move and the eval should
  // still report +M, meaning white mates. If it flipped to -M, white
  // blundered into getting mated instead.
  const stillMating =
    (moverColor === 'w' && evalAfterMate > 0) ||
    (moverColor === 'b' && evalAfterMate < 0);
  return !stillMating;
}

/**
 * Classify a single move given the eval-before / eval-after snapshot.
 * Positions with only one legal move are skipped (return quality = null).
 */
export function classifyMove(input: ClassifyInput): ClassifyResult {
  if (input.onlyLegalMove) {
    return { quality: null, cpLoss: 0 };
  }

  const before = toMoverCp(input.evalBeforeCp, input.evalBeforeMate, input.moverColor);
  const after = toMoverCp(input.evalAfterCp, input.evalAfterMate, input.moverColor);
  const cpLoss = before - after;

  // Losing a forced mate is always a blunder, regardless of cpLoss
  // arithmetic (the sentinel usually puts us there anyway, but the
  // explicit check makes the intent obvious and covers edge cases).
  if (lostForcedMate(input)) {
    return { quality: 'blunder', cpLoss };
  }

  let quality: MoveQuality;
  if (cpLoss <= 10) quality = 'best';
  else if (cpLoss <= 25) quality = 'excellent';
  else if (cpLoss <= 50) quality = 'good';
  else if (cpLoss <= 100) quality = 'inaccuracy';
  else if (cpLoss <= 200) quality = 'mistake';
  else quality = 'blunder';

  return { quality, cpLoss };
}

/** Short label shown on the CoachPanel quality badge. */
export const QUALITY_LABELS: Record<MoveQuality, string> = {
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  book: 'Book',
};

/** Tailwind-friendly color swatch for quality badges. */
export const QUALITY_COLORS: Record<MoveQuality, string> = {
  best: 'bg-emerald-500 text-emerald-950',
  excellent: 'bg-emerald-400 text-emerald-950',
  good: 'bg-lime-400 text-lime-950',
  inaccuracy: 'bg-amber-400 text-amber-950',
  mistake: 'bg-orange-500 text-orange-950',
  blunder: 'bg-rose-500 text-rose-50',
  book: 'bg-slate-400 text-slate-950',
};
