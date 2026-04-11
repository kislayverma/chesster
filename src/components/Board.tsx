import { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Arrow, Square } from 'react-chessboard/dist/chessboard/types';
import { useGameStore } from '../game/gameStore';
import {
  marbleCustomPieces,
  marbleDarkSquareStyle,
  marbleLightSquareStyle,
} from './boardAssets';

interface BoardProps {
  orientation?: 'white' | 'black';
}

/** Amber highlight for the "you should have played this" arrow. */
const COACH_ARROW_COLOR = 'rgb(245, 158, 11)'; // tailwind amber-500

/**
 * Phase 1 board — a thin wrapper around react-chessboard that reads
 * the current FEN from the game store and reports drops back into it.
 *
 * Phase 6 addition: when the coach has classified the current move as
 * an inaccuracy/mistake/blunder, we overlay an arrow on the board
 * drawn from the engine's pre-move best move (`lastMoveBestMoveBefore`,
 * UCI). The arrow is derived at render time so it automatically
 * appears on navigation (goToNode refreshes both `lastMoveQuality`
 * and `lastMoveBestMoveBefore` from the visited node) and clears on
 * best/excellent/good moves or when no classification is available.
 *
 * Promotions always default to a queen for now; a promotion picker UI
 * will land in Phase 8 polish.
 */
export default function Board({ orientation = 'white' }: BoardProps) {
  const fen = useGameStore((s) => s.fen);
  const makeMove = useGameStore((s) => s.makeMove);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const lastMoveQuality = useGameStore((s) => s.lastMoveQuality);
  const lastMoveBestMoveBefore = useGameStore((s) => s.lastMoveBestMoveBefore);

  const onPieceDrop = (sourceSquare: string, targetSquare: string): boolean => {
    if (isGameOver) return false;
    return makeMove(sourceSquare, targetSquare, 'q');
  };

  const customArrows = useMemo<Arrow[]>(() => {
    if (!lastMoveBestMoveBefore) return [];
    if (
      lastMoveQuality !== 'inaccuracy' &&
      lastMoveQuality !== 'mistake' &&
      lastMoveQuality !== 'blunder'
    ) {
      return [];
    }
    // UCI is like "e2e4" or "e7e8q" (promotion suffix). We only need
    // the from/to squares; promotion letter is ignored for the arrow.
    const from = lastMoveBestMoveBefore.slice(0, 2) as Square;
    const to = lastMoveBestMoveBefore.slice(2, 4) as Square;
    if (!from || !to || from === to) return [];
    return [[from, to, COACH_ARROW_COLOR]];
  }, [lastMoveQuality, lastMoveBestMoveBefore]);

  return (
    <div className="w-full max-w-[640px] aspect-square">
      <Chessboard
        position={fen}
        onPieceDrop={onPieceDrop}
        boardOrientation={orientation}
        customArrows={customArrows}
        customBoardStyle={{
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
        customPieces={marbleCustomPieces}
        customDarkSquareStyle={marbleDarkSquareStyle}
        customLightSquareStyle={marbleLightSquareStyle}
        animationDuration={150}
      />
    </div>
  );
}
