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
 */

import { Chessboard } from 'react-chessboard';
import {
  marbleCustomPieces,
  marbleDarkSquareStyle,
  marbleLightSquareStyle,
} from './boardAssets';

interface MiniBoardProps {
  fen: string;
  orientation?: 'white' | 'black';
}

export default function MiniBoard({ fen, orientation = 'white' }: MiniBoardProps) {
  return (
    <div className="pointer-events-none aspect-square w-full">
      <Chessboard
        position={fen}
        boardOrientation={orientation}
        arePiecesDraggable={false}
        customBoardStyle={{
          borderRadius: '4px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
        }}
        customPieces={marbleCustomPieces}
        customDarkSquareStyle={marbleDarkSquareStyle}
        customLightSquareStyle={marbleLightSquareStyle}
        animationDuration={0}
      />
    </div>
  );
}
