/**
 * Phase 6 MiniBoard.
 *
 * A tiny, read-only chessboard used inside StackPanel to preview each
 * stack frame's tip position. Unlike `Board.tsx` (which is wired to
 * the live game store) this component takes a FEN + orientation as
 * props so it can render an arbitrary position.
 *
 * Piece dragging is disabled and `pointer-events-none` is applied so
 * the surrounding clickable card in StackPanel still swallows clicks
 * and can pop the stack.
 *
 * Optional `customSquareStyles` prop lets the caller highlight
 * specific squares (e.g. wrong move in red, alternate in green).
 */

import { Chessboard } from 'react-chessboard';
import type { CustomSquareStyles } from 'react-chessboard/dist/chessboard/types';

interface MiniBoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  customSquareStyles?: CustomSquareStyles;
}

export default function MiniBoard({
  fen,
  orientation = 'white',
  customSquareStyles,
}: MiniBoardProps) {
  return (
    <div className="pointer-events-none aspect-square w-full">
      <Chessboard
        position={fen}
        boardOrientation={orientation}
        arePiecesDraggable={false}
        customSquareStyles={customSquareStyles}
        customBoardStyle={{
          borderRadius: '4px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
        }}
        animationDuration={0}
      />
    </div>
  );
}
