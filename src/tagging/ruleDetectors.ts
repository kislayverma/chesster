/**
 * Phase 3 rule-based motif detectors.
 *
 * Implements the 5 initial motifs from DESIGN.md §7:
 *   1. missed_mate        — pre-move had mate for mover, post-move doesn't
 *   2. missed_capture     — engine's top move was a capture, player ignored it
 *   3. hanging_piece      — opponent's best reply is a capture
 *   4. missed_fork        — engine's top move lands on a square attacking
 *                           two or more enemy non-pawn pieces
 *   5. back_rank_weakness — mover's king on back rank with no luft and the
 *                           move was tagged as a mistake/blunder
 *
 * All detectors are pure functions over a `DetectorContext`. Each returns
 * either a motif id or null. `runRuleDetectors` composes them and
 * deduplicates.
 *
 * These heuristics are deliberately conservative: we prefer false
 * negatives over false positives so the CoachPanel never accuses the
 * player of missing a fork that wasn't there. Phase 12 polish can tighten
 * the detectors and add the later motifs (missed_pin, missed_skewer, ...).
 */

import { Chess, type Move, type Square } from 'chess.js';
import type { MoveQuality } from '../game/moveClassifier';
import type { MotifId } from './motifs';

export interface DetectorContext {
  /** Position BEFORE the player's move. */
  fenBefore: string;
  /** Position AFTER the player's move. */
  fenAfter: string;
  /** UCI of the move the player actually played (e.g. "e2e4"). */
  playerMoveUci: string;
  /** Engine's top move from the pre-move analysis, if any (UCI). */
  bestMoveBeforeUci: string | null;
  /** White-perspective eval BEFORE the player's move. */
  evalBeforeCp: number | null;
  evalBeforeMate: number | null;
  /** White-perspective eval AFTER the player's move. */
  evalAfterCp: number | null;
  evalAfterMate: number | null;
  /** Principal variation from post-move analysis (UCI; starts with opponent's reply). */
  pvAfter: string[];
  /** Which color made the move being tagged. */
  moverColor: 'w' | 'b';
  /** Classification result for the move (may be null when skipped). */
  quality: MoveQuality | null;
}

type Detector = (ctx: DetectorContext) => MotifId | null;

/**
 * #1 missed_mate — mover had a forced mate before the move, didn't play it.
 * Pure eval-arithmetic; no chess.js needed.
 */
const detectMissedMate: Detector = (ctx) => {
  const { evalBeforeMate, evalAfterMate, moverColor } = ctx;
  if (evalBeforeMate == null) return null;

  const wasMating =
    (moverColor === 'w' && evalBeforeMate > 0) ||
    (moverColor === 'b' && evalBeforeMate < 0);
  if (!wasMating) return null;

  const stillMating =
    evalAfterMate != null &&
    ((moverColor === 'w' && evalAfterMate > 0) ||
      (moverColor === 'b' && evalAfterMate < 0));
  return stillMating ? null : 'missed_mate';
};

/**
 * #2 missed_capture — engine's top move in the pre-move position was a
 * capture, but the player played something different. Only fires on
 * inaccuracy/mistake/blunder — a strong positional move is often
 * worth more than an available capture, and we don't want to nag.
 */
const detectMissedCapture: Detector = (ctx) => {
  const { fenBefore, bestMoveBeforeUci, playerMoveUci, quality } = ctx;
  if (!bestMoveBeforeUci) return null;
  if (bestMoveBeforeUci === playerMoveUci) return null;
  if (
    quality !== 'inaccuracy' &&
    quality !== 'mistake' &&
    quality !== 'blunder'
  ) {
    return null;
  }

  try {
    const clone = new Chess(fenBefore);
    const parsed = clone.move({
      from: bestMoveBeforeUci.slice(0, 2) as Square,
      to: bestMoveBeforeUci.slice(2, 4) as Square,
      promotion: bestMoveBeforeUci.length >= 5 ? bestMoveBeforeUci[4] : undefined,
    }) as Move | null;
    if (!parsed) return null;
    if (parsed.captured) return 'missed_capture';
  } catch {
    return null;
  }
  return null;
};

/**
 * #3 hanging_piece — opponent's best reply after the player's move is
 * a capture. This catches "I moved my knight to a square where it gets
 * taken" with high reliability when the cp swing is big. We only fire
 * on mistake/blunder so trades don't get flagged.
 */
const detectHangingPiece: Detector = (ctx) => {
  const { pvAfter, fenAfter, quality } = ctx;
  if (quality !== 'mistake' && quality !== 'blunder') return null;
  if (!pvAfter || pvAfter.length === 0) return null;

  const first = pvAfter[0];
  if (!first || first.length < 4) return null;

  try {
    const clone = new Chess(fenAfter);
    const parsed = clone.move({
      from: first.slice(0, 2) as Square,
      to: first.slice(2, 4) as Square,
      promotion: first.length >= 5 ? first[4] : undefined,
    }) as Move | null;
    if (!parsed) return null;
    if (parsed.captured) return 'hanging_piece';
  } catch {
    return null;
  }
  return null;
};

/** Replace the side-to-move field of a FEN. Also clears en-passant. */
function withTurn(fen: string, turn: 'w' | 'b'): string {
  const parts = fen.split(/\s+/);
  if (parts.length < 6) return fen;
  parts[1] = turn;
  parts[3] = '-';
  return parts.join(' ');
}

/**
 * #4 missed_fork — after playing `bestMoveBefore`, the moved piece
 * would be attacking 2+ enemy non-pawn pieces. We build a FEN with the
 * turn flipped back to the mover so we can enumerate capture moves
 * from the destination square. If the bestMove gives check, chess.js
 * will reject the flipped FEN and we bail silently.
 */
const detectMissedFork: Detector = (ctx) => {
  const { fenBefore, bestMoveBeforeUci, playerMoveUci, moverColor, quality } = ctx;
  if (!bestMoveBeforeUci) return null;
  if (bestMoveBeforeUci === playerMoveUci) return null;
  if (
    quality !== 'inaccuracy' &&
    quality !== 'mistake' &&
    quality !== 'blunder'
  ) {
    return null;
  }

  try {
    const clone = new Chess(fenBefore);
    const parsed = clone.move({
      from: bestMoveBeforeUci.slice(0, 2) as Square,
      to: bestMoveBeforeUci.slice(2, 4) as Square,
      promotion: bestMoveBeforeUci.length >= 5 ? bestMoveBeforeUci[4] : undefined,
    }) as Move | null;
    if (!parsed) return null;
    const dest = parsed.to as Square;

    // If the best move delivers check, the flipped-turn trick won't
    // load (opponent's king would be "not to move" in check). Skip —
    // most checking best moves aren't multi-target forks anyway, and
    // the ones that are (check-fork) will still show up as a mate or
    // hanging-piece tag.
    if (clone.inCheck()) return null;

    const flippedFen = withTurn(clone.fen(), moverColor);
    let flipped: Chess;
    try {
      flipped = new Chess(flippedFen);
    } catch {
      return null;
    }
    const moves = flipped.moves({ square: dest, verbose: true }) as Move[];
    const valuableCaptures = moves.filter(
      (m) => m.captured && m.captured !== 'p' && m.captured !== 'k'
    );
    if (valuableCaptures.length >= 2) return 'missed_fork';
  } catch {
    return null;
  }
  return null;
};

/**
 * #5 back_rank_weakness — the mover's king is on its back rank with
 * no luft on the rank in front of it, and the move was a mistake or
 * blunder (suggesting the player failed to address the weakness).
 * This is a cheap structural check: we look at the three squares on
 * the second rank directly above the king (or below, for black).
 */
const detectBackRankWeakness: Detector = (ctx) => {
  const { fenBefore, moverColor, quality } = ctx;
  if (
    quality !== 'inaccuracy' &&
    quality !== 'mistake' &&
    quality !== 'blunder'
  ) {
    return null;
  }

  try {
    const chess = new Chess(fenBefore);
    const board = chess.board();
    let kingSquare: Square | null = null;
    for (const row of board) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === moverColor) {
          kingSquare = cell.square;
        }
      }
    }
    if (!kingSquare) return null;

    const backRank = moverColor === 'w' ? '1' : '8';
    if (kingSquare[1] !== backRank) return null;

    const luftRank = moverColor === 'w' ? '2' : '7';
    const fileCode = kingSquare.charCodeAt(0) - 'a'.charCodeAt(0);
    const files: number[] = [];
    if (fileCode > 0) files.push(fileCode - 1);
    files.push(fileCode);
    if (fileCode < 7) files.push(fileCode + 1);

    let hasLuft = false;
    for (const fc of files) {
      const sq = `${String.fromCharCode('a'.charCodeAt(0) + fc)}${luftRank}` as Square;
      const piece = chess.get(sq);
      // Any empty adjacent second-rank square is "luft". An adjacent
      // square occupied by a non-own-pawn piece is slow luft but still
      // counts for this crude check — we only fire when all three
      // squares in front of the king are plugged by the mover's own
      // pawns.
      if (!piece || piece.type !== 'p' || piece.color !== moverColor) {
        hasLuft = true;
        break;
      }
    }
    if (hasLuft) return null;
    return 'back_rank_weakness';
  } catch {
    return null;
  }
};

const DETECTORS: Detector[] = [
  detectMissedMate,
  detectMissedCapture,
  detectHangingPiece,
  detectMissedFork,
  detectBackRankWeakness,
];

/** Run all rule detectors against the context and return deduped motif ids. */
export function runRuleDetectors(ctx: DetectorContext): MotifId[] {
  const out: MotifId[] = [];
  for (const d of DETECTORS) {
    const tag = d(ctx);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
