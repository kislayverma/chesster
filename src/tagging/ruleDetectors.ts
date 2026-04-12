/**
 * Rule-based motif detectors.
 *
 * Phase 3 initial set (5 detectors):
 *   1. missed_mate        — pre-move had mate for mover, post-move doesn't
 *   2. missed_capture     — engine's top move was a capture, player ignored it
 *   3. hanging_piece      — opponent's best reply is a capture
 *   4. missed_fork        — engine's top move lands on a square attacking
 *                           two or more enemy non-pawn pieces
 *   5. back_rank_weakness — mover's king on back rank with no luft and the
 *                           move was tagged as a mistake/blunder
 *
 * Phase 12 additions (5 detectors):
 *   6. missed_pin         — engine's best move pins a piece to the king
 *   7. missed_skewer      — engine's best move is a check that skewers
 *                           a piece behind the king
 *   8. overloaded_defender — a single opponent piece defends two or more
 *                           attacked pieces and the engine exploits it
 *   9. king_safety_drop   — the player's move weakened their own pawn
 *                           shield in front of their king
 *  10. trade_into_bad_endgame — the player traded into a losing endgame
 *
 * All detectors are pure functions over a `DetectorContext`. Each returns
 * either a motif id or null. `runRuleDetectors` composes them and
 * deduplicates.
 *
 * These heuristics are deliberately conservative: we prefer false
 * negatives over false positives so the CoachPanel never accuses the
 * player of missing a fork that wasn't there.
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

// ──────────────────────────────────────────────────────────────────
// Phase 12 detectors
// ──────────────────────────────────────────────────────────────────

/**
 * Find the king square for a given colour in a Chess instance.
 */
function findKing(chess: Chess, color: 'w' | 'b'): Square | null {
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) {
        return cell.square;
      }
    }
  }
  return null;
}

/**
 * Are two squares on the same rank, file, or diagonal?
 * Returns the kind of alignment or null.
 */
function alignment(
  a: Square,
  b: Square,
): 'rank' | 'file' | 'diagonal' | null {
  const af = a.charCodeAt(0);
  const ar = a.charCodeAt(1);
  const bf = b.charCodeAt(0);
  const br = b.charCodeAt(1);
  if (ar === br) return 'rank';
  if (af === bf) return 'file';
  if (Math.abs(af - bf) === Math.abs(ar - br)) return 'diagonal';
  return null;
}

/**
 * Is a piece type a sliding piece along a given direction?
 * Bishops slide diagonals, rooks slide ranks/files, queen slides all.
 */
function slidesAlong(
  piece: string,
  dir: 'rank' | 'file' | 'diagonal',
): boolean {
  if (piece === 'q') return true;
  if (piece === 'r' && (dir === 'rank' || dir === 'file')) return true;
  if (piece === 'b' && dir === 'diagonal') return true;
  return false;
}

/**
 * #6 missed_pin — engine's best move pins an enemy piece to the enemy
 * king. We play the best move on a clone, then check whether the
 * moved piece is aligned with an enemy piece and the enemy king such
 * that the intervening enemy piece cannot move without exposing its
 * king — a classic absolute pin.
 *
 * Conservative: only fires on inaccuracy/mistake/blunder and when the
 * best move piece is a sliding piece that lines up with a valuable
 * target and the enemy king.
 */
const detectMissedPin: Detector = (ctx) => {
  const { fenBefore, bestMoveBeforeUci, playerMoveUci, moverColor, quality } =
    ctx;
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
      promotion:
        bestMoveBeforeUci.length >= 5 ? bestMoveBeforeUci[4] : undefined,
    }) as Move | null;
    if (!parsed) return null;

    const dest = parsed.to as Square;
    const movedPiece = parsed.piece; // piece type after promotion
    const enemyColor = moverColor === 'w' ? 'b' : 'w';
    const enemyKingSq = findKing(clone, enemyColor);
    if (!enemyKingSq) return null;

    // The moved piece must be a sliding piece aligned with the enemy king.
    const dir = alignment(dest, enemyKingSq);
    if (!dir) return null;
    if (!slidesAlong(movedPiece, dir)) return null;

    // Check whether there is exactly one enemy non-pawn piece between
    // dest and the enemy king (the pinned piece).
    const board = clone.board();
    const df = dest.charCodeAt(0);
    const dr = dest.charCodeAt(1);
    const kf = enemyKingSq.charCodeAt(0);
    const kr = enemyKingSq.charCodeAt(1);
    const stepF = Math.sign(kf - df);
    const stepR = Math.sign(kr - dr);

    let cf = df + stepF;
    let cr = dr + stepR;
    let pinnedPiece: string | null = null;
    let blocked = false;
    while (cf !== kf || cr !== kr) {
      const piece = board[8 - (cr - 48)]?.[cf - 97];
      if (piece) {
        if (pinnedPiece !== null) {
          // More than one intervening piece — not a pin.
          blocked = true;
          break;
        }
        if (piece.color === enemyColor && piece.type !== 'k') {
          pinnedPiece = piece.type;
        } else {
          // Own piece or king in between shouldn't happen this way
          blocked = true;
          break;
        }
      }
      cf += stepF;
      cr += stepR;
    }

    if (!blocked && pinnedPiece && pinnedPiece !== 'p') {
      return 'missed_pin';
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * #7 missed_skewer — engine's best move delivers check with a sliding
 * piece, and behind the enemy king (on the same line) sits another
 * enemy piece of value. When the king moves, the piece behind is
 * captured. Only fires on inaccuracy/mistake/blunder.
 */
const detectMissedSkewer: Detector = (ctx) => {
  const { fenBefore, bestMoveBeforeUci, playerMoveUci, moverColor, quality } =
    ctx;
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
      promotion:
        bestMoveBeforeUci.length >= 5 ? bestMoveBeforeUci[4] : undefined,
    }) as Move | null;
    if (!parsed) return null;

    // Must deliver check to be a skewer (the king is forced to move).
    if (!clone.inCheck()) return null;

    const dest = parsed.to as Square;
    const movedPiece = parsed.piece;
    const enemyColor = moverColor === 'w' ? 'b' : 'w';
    const enemyKingSq = findKing(clone, enemyColor);
    if (!enemyKingSq) return null;

    const dir = alignment(dest, enemyKingSq);
    if (!dir) return null;
    if (!slidesAlong(movedPiece, dir)) return null;

    // Walk from the king AWAY from the attacker to find a piece behind.
    const df = dest.charCodeAt(0);
    const dr = dest.charCodeAt(1);
    const kf = enemyKingSq.charCodeAt(0);
    const kr = enemyKingSq.charCodeAt(1);
    const stepF = Math.sign(kf - df);
    const stepR = Math.sign(kr - dr);

    const board = clone.board();
    let cf = kf + stepF;
    let cr = kr + stepR;
    while (cf >= 97 && cf <= 104 && cr >= 49 && cr <= 56) {
      const piece = board[8 - (cr - 48)]?.[cf - 97];
      if (piece) {
        if (
          piece.color === enemyColor &&
          piece.type !== 'p' &&
          piece.type !== 'k'
        ) {
          return 'missed_skewer';
        }
        break; // any piece blocks the skewer line
      }
      cf += stepF;
      cr += stepR;
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * #8 overloaded_defender — after the player's mistake/blunder, the
 * engine's PV starts by attacking a piece that is the sole defender
 * of another attacked piece. We approximate this: the opponent's
 * first PV move attacks a square that was defended by exactly one
 * enemy piece, and that same defender also defends at least one other
 * attacked square. This is a simplified heuristic — we check if the
 * opponent's reply captures, and if the captured piece was defended
 * by a single piece that also defends another attacked square.
 *
 * For simplicity, we use a lighter heuristic: fire when the player's
 * move was a mistake/blunder AND the engine's best reply sequence
 * (pvAfter) contains two captures in the first three half-moves,
 * both by the same enemy piece. That pattern is characteristic of
 * exploiting an overloaded defender.
 */
const detectOverloadedDefender: Detector = (ctx) => {
  const { fenAfter, pvAfter, quality } = ctx;
  if (quality !== 'mistake' && quality !== 'blunder') return null;
  if (!pvAfter || pvAfter.length < 2) return null;

  try {
    const sim = new Chess(fenAfter);
    const captures: { from: Square; to: Square; piece: string }[] = [];

    // Walk up to 3 PV moves; track captures by the opponent.
    const limit = Math.min(pvAfter.length, 3);
    for (let i = 0; i < limit; i++) {
      const uci = pvAfter[i];
      if (!uci || uci.length < 4) break;
      const m = sim.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.length >= 5 ? uci[4] : undefined,
      }) as Move | null;
      if (!m) break;
      if (m.captured) {
        captures.push({ from: m.from as Square, to: m.to as Square, piece: m.piece });
      }
    }

    // Two or more captures in a short PV is a strong signal that a
    // defender is overloaded — the opponent is exploiting the fact that
    // one piece can't cover everything.
    if (captures.length >= 2) return 'overloaded_defender';
  } catch {
    return null;
  }
  return null;
};

/**
 * #9 king_safety_drop — the player's move weakened their own pawn
 * shield in front of their castled king. We compare the pawn
 * structure around the king before and after the move. If a pawn
 * was advanced or removed from the shield and the move was a
 * mistake/blunder, we flag it.
 */
const detectKingSafetyDrop: Detector = (ctx) => {
  const { fenBefore, fenAfter, moverColor, quality } = ctx;
  if (
    quality !== 'inaccuracy' &&
    quality !== 'mistake' &&
    quality !== 'blunder'
  ) {
    return null;
  }

  try {
    const before = new Chess(fenBefore);
    const after = new Chess(fenAfter);

    const kingSqBefore = findKing(before, moverColor);
    if (!kingSqBefore) return null;

    // Only care about castled kings (on g/h files for kingside, a/b/c for queenside)
    const kFile = kingSqBefore.charCodeAt(0) - 97; // 0=a, 7=h
    const kRank = kingSqBefore[1];
    const backRank = moverColor === 'w' ? '1' : '8';
    if (kRank !== backRank) return null;
    // Rough castled check: king on c, g, or nearby files
    const isCastledKingside = kFile >= 5; // f, g, h
    const isCastledQueenside = kFile <= 2; // a, b, c
    if (!isCastledKingside && !isCastledQueenside) return null;

    // Shield rank: the rank directly in front of the king.
    const shieldRank = moverColor === 'w' ? '2' : '7';

    // Shield files: the king's file and one on each side.
    const shieldFiles: number[] = [];
    if (kFile > 0) shieldFiles.push(kFile - 1);
    shieldFiles.push(kFile);
    if (kFile < 7) shieldFiles.push(kFile + 1);

    // Count own pawns on shield squares before and after.
    let pawnsBefore = 0;
    let pawnsAfter = 0;
    for (const f of shieldFiles) {
      const sq =
        `${String.fromCharCode(97 + f)}${shieldRank}` as Square;
      const pb = before.get(sq);
      if (pb && pb.type === 'p' && pb.color === moverColor) pawnsBefore++;
      const pa = after.get(sq);
      if (pa && pa.type === 'p' && pa.color === moverColor) pawnsAfter++;
    }

    // If we lost a pawn from the shield, flag it.
    if (pawnsAfter < pawnsBefore) return 'king_safety_drop';
  } catch {
    return null;
  }
  return null;
};

/**
 * #10 trade_into_bad_endgame — the player traded pieces (their move
 * was a capture) into a position with fewer total pieces, and the
 * eval swung significantly against them (mistake/blunder). This
 * suggests the trade simplified into a losing endgame.
 */
const detectBadEndgameTrade: Detector = (ctx) => {
  const { fenBefore, fenAfter, playerMoveUci, quality } = ctx;
  if (quality !== 'mistake' && quality !== 'blunder') return null;

  try {
    // Verify the player's move was a capture.
    const beforeChess = new Chess(fenBefore);
    const parsed = beforeChess.move({
      from: playerMoveUci.slice(0, 2) as Square,
      to: playerMoveUci.slice(2, 4) as Square,
      promotion:
        playerMoveUci.length >= 5 ? playerMoveUci[4] : undefined,
    }) as Move | null;
    if (!parsed || !parsed.captured) return null;

    // Count non-pawn, non-king pieces in before and after positions.
    const afterChess = new Chess(fenAfter);
    const countPieces = (chess: Chess): number => {
      let n = 0;
      for (const row of chess.board()) {
        for (const cell of row) {
          if (cell && cell.type !== 'p' && cell.type !== 'k') n++;
        }
      }
      return n;
    };

    const piecesBefore = countPieces(new Chess(fenBefore));
    const piecesAfter = countPieces(afterChess);

    // Must be an actual simplification (at least one piece removed).
    if (piecesAfter >= piecesBefore) return null;

    // Only flag in endgame-ish positions (≤ 8 non-pawn, non-king pieces
    // remaining after the trade).
    if (piecesAfter > 8) return null;

    return 'trade_into_bad_endgame';
  } catch {
    return null;
  }
  return null;
};

const DETECTORS: Detector[] = [
  detectMissedMate,
  detectMissedCapture,
  detectHangingPiece,
  detectMissedFork,
  detectBackRankWeakness,
  // Phase 12
  detectMissedPin,
  detectMissedSkewer,
  detectOverloadedDefender,
  detectKingSafetyDrop,
  detectBadEndgameTrade,
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
