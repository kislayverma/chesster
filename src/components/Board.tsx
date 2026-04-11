import { Chessboard } from 'react-chessboard';
import { useGameStore } from '../game/gameStore';

interface BoardProps {
  orientation?: 'white' | 'black';
}

/**
 * Phase 1 board — a thin wrapper around react-chessboard that reads
 * the current FEN from the game store and reports drops back into it.
 *
 * Promotions always default to a queen for now; a promotion picker UI
 * will land in Phase 8 polish.
 */
export default function Board({ orientation = 'white' }: BoardProps) {
  const fen = useGameStore((s) => s.fen);
  const makeMove = useGameStore((s) => s.makeMove);
  const isGameOver = useGameStore((s) => s.isGameOver);

  const onPieceDrop = (sourceSquare: string, targetSquare: string): boolean => {
    if (isGameOver) return false;
    return makeMove(sourceSquare, targetSquare, 'q');
  };

  return (
    <div className="w-full max-w-[640px] aspect-square">
      <Chessboard
        position={fen}
        onPieceDrop={onPieceDrop}
        boardOrientation={orientation}
        customBoardStyle={{
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
        customDarkSquareStyle={{ backgroundColor: '#475569' }}
        customLightSquareStyle={{ backgroundColor: '#cbd5e1' }}
        animationDuration={150}
      />
    </div>
  );
}
