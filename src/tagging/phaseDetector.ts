/**
 * Phase 3 phase detector.
 *
 * Classifies a position as opening / middlegame / endgame using simple
 * heuristics over the FEN:
 *
 *   • Opening: fullmove number ≤ 10 AND both queens still on the board
 *   • Endgame: ≤ 6 non-king non-pawn pieces total on the board,
 *              OR both queens off and ≤ 10 non-king pieces total
 *   • Middlegame: everything else
 *
 * This is intentionally cheap — no piece-value counting, no ECO
 * lookup. The phase tag is used for template selection and weakness
 * roll-ups, not for strategic analysis.
 */

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export function detectPhase(fen: string): GamePhase {
  const parts = fen.split(/\s+/);
  const board = parts[0] ?? '';
  // FEN fullmove number is the 6th field; defaults to 1 if malformed.
  const fullmove = parseInt(parts[5] ?? '1', 10) || 1;

  let whiteQueens = 0;
  let blackQueens = 0;
  let nonKingNonPawnPieces = 0;
  let nonKingPieces = 0;

  for (const ch of board) {
    if (ch === '/') continue;
    if (ch >= '0' && ch <= '9') continue;
    const upper = ch.toUpperCase();
    if (upper === 'K') continue;
    nonKingPieces += 1;
    if (upper !== 'P') nonKingNonPawnPieces += 1;
    if (ch === 'Q') whiteQueens += 1;
    if (ch === 'q') blackQueens += 1;
  }

  const queensOn = whiteQueens > 0 && blackQueens > 0;

  if (fullmove <= 10 && queensOn) return 'opening';
  if (nonKingNonPawnPieces <= 6) return 'endgame';
  if (!queensOn && nonKingPieces <= 10) return 'endgame';
  return 'middlegame';
}
