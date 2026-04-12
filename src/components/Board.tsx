import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type {
  Arrow,
  CustomSquareStyles,
  Piece,
  PromotionPieceOption,
  Square,
} from 'react-chessboard/dist/chessboard/types';
import { useGameStore } from '../game/gameStore';
import { playMoveSound, playCaptureSound } from '../lib/moveSound';

interface BoardProps {
  orientation?: 'white' | 'black';
}

/** Amber highlight for the "you should have played this" arrow. */
const COACH_ARROW_COLOR = 'rgb(245, 158, 11)'; // tailwind amber-500

/** Semi-transparent highlight for the last-move squares. */
const LAST_MOVE_STYLE: Record<string, string | number> = {
  backgroundColor: 'rgba(255, 255, 0, 0.3)',
};

/** Dot indicator for legal move targets (empty square). */
const LEGAL_DOT_STYLE: Record<string, string | number> = {
  background: 'radial-gradient(circle, rgba(0,0,0,0.25) 25%, transparent 25%)',
  borderRadius: '50%',
};

/** Ring indicator for legal move targets (occupied square = capture). */
const LEGAL_CAPTURE_STYLE: Record<string, string | number> = {
  background: 'radial-gradient(circle, transparent 55%, rgba(0,0,0,0.25) 55%)',
  borderRadius: '50%',
};

/** Highlight for the selected piece's own square. */
const SELECTED_SQUARE_STYLE: Record<string, string | number> = {
  backgroundColor: 'rgba(255, 255, 0, 0.45)',
};

export default function Board({ orientation = 'white' }: BoardProps) {
  const fen = useGameStore((s) => s.fen);
  const makeMove = useGameStore((s) => s.makeMove);
  const isGameOver = useGameStore((s) => s.isGameOver);
  const result = useGameStore((s) => s.result);
  const reset = useGameStore((s) => s.reset);
  const inCheck = useGameStore((s) => s.inCheck);
  const lastMoveQuality = useGameStore((s) => s.lastMoveQuality);
  const lastMoveBestMoveBefore = useGameStore((s) => s.lastMoveBestMoveBefore);
  const lastMoveFrom = useGameStore((s) => s.lastMoveFrom);
  const lastMoveTo = useGameStore((s) => s.lastMoveTo);

  // ─── Game-over modal state ──────────────────────────────────────
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const prevGameOver = useRef(isGameOver);
  // Reset dismissed state when a new game starts (isGameOver goes false).
  if (!isGameOver && prevGameOver.current) {
    setGameOverDismissed(false);
  }
  prevGameOver.current = isGameOver;

  const showGameOverModal = isGameOver && !gameOverDismissed;

  // ─── Promotion dialog state ────────────────────────────────────
  const [showPromotion, setShowPromotion] = useState(false);
  const [promotionSquare, setPromotionSquare] = useState<Square | null>(null);
  const pendingPromotion = useRef<{ from: string; to: string } | null>(null);

  // ─── Legal-moves-on-click state ────────────────────────────────
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState<CustomSquareStyles>({});

  // ─── Sound: play on every FEN change that has a lastMove ───────
  const prevFen = useRef(fen);
  useEffect(() => {
    if (fen !== prevFen.current && lastMoveTo) {
      // Crude capture detection: check if the FEN's piece count dropped.
      // Simpler: check if the target square in the *previous* FEN had a piece.
      try {
        const prev = new Chess(prevFen.current);
        const targetPiece = prev.get(lastMoveTo as Square);
        if (targetPiece) {
          playCaptureSound();
        } else {
          playMoveSound();
        }
      } catch {
        playMoveSound();
      }
    }
    prevFen.current = fen;
  }, [fen, lastMoveTo]);

  // Clear selected square when position changes.
  useEffect(() => {
    setSelectedSquare(null);
    setLegalMoveSquares({});
  }, [fen]);

  /**
   * Compute legal moves for a piece on the given square and set
   * the highlight state. If the square is already selected, deselect.
   */
  const highlightLegalMoves = useCallback(
    (square: Square) => {
      if (isGameOver) return;
      if (selectedSquare === square) {
        // Toggle off.
        setSelectedSquare(null);
        setLegalMoveSquares({});
        return;
      }
      try {
        const chess = new Chess(fen);
        const moves = chess.moves({ square, verbose: true });
        if (moves.length === 0) {
          setSelectedSquare(null);
          setLegalMoveSquares({});
          return;
        }
        const styles: CustomSquareStyles = {
          [square]: SELECTED_SQUARE_STYLE,
        };
        for (const m of moves) {
          styles[m.to as Square] = m.captured
            ? LEGAL_CAPTURE_STYLE
            : LEGAL_DOT_STYLE;
        }
        setSelectedSquare(square);
        setLegalMoveSquares(styles);
      } catch {
        setSelectedSquare(null);
        setLegalMoveSquares({});
      }
    },
    [fen, isGameOver, selectedSquare],
  );

  /**
   * Is this drop a pawn promotion?
   */
  const isPromotionMove = useCallback(
    (_source: Square, target: Square, piece: Piece): boolean => {
      if (piece[1] !== 'P') return false;
      const targetRank = target[1];
      if (piece[0] === 'w' && targetRank === '8') return true;
      if (piece[0] === 'b' && targetRank === '1') return true;
      return false;
    },
    [],
  );

  const onPieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string, piece: Piece): boolean => {
      if (isGameOver) return false;
      setSelectedSquare(null);
      setLegalMoveSquares({});

      if (isPromotionMove(sourceSquare as Square, targetSquare as Square, piece)) {
        pendingPromotion.current = { from: sourceSquare, to: targetSquare };
        setPromotionSquare(targetSquare as Square);
        setShowPromotion(true);
        return false;
      }

      return makeMove(sourceSquare, targetSquare);
    },
    [isGameOver, makeMove, isPromotionMove],
  );

  const onPromotionPieceSelect = useCallback(
    (
      piece?: PromotionPieceOption,
      _promoteFromSquare?: Square,
      _promoteToSquare?: Square,
    ): boolean => {
      setShowPromotion(false);
      setPromotionSquare(null);
      const pending = pendingPromotion.current;
      pendingPromotion.current = null;
      if (!pending || !piece) return false;
      const promoChar = piece[1].toLowerCase();
      return makeMove(pending.from, pending.to, promoChar);
    },
    [makeMove],
  );

  /**
   * Click on a piece: show its legal moves. Click on a highlighted
   * target square: execute the move (click-to-move).
   */
  const onSquareClick = useCallback(
    (square: Square) => {
      // If a piece is selected and the clicked square is a legal target,
      // execute the move.
      if (selectedSquare && legalMoveSquares[square]) {
        // Check if it's a pawn promotion.
        try {
          const chess = new Chess(fen);
          const piece = chess.get(selectedSquare);
          if (piece && piece.type === 'p') {
            const targetRank = square[1];
            const isPromo =
              (piece.color === 'w' && targetRank === '8') ||
              (piece.color === 'b' && targetRank === '1');
            if (isPromo) {
              pendingPromotion.current = { from: selectedSquare, to: square };
              setPromotionSquare(square);
              setShowPromotion(true);
              setSelectedSquare(null);
              setLegalMoveSquares({});
              return;
            }
          }
        } catch { /* proceed with normal move */ }

        makeMove(selectedSquare, square);
        setSelectedSquare(null);
        setLegalMoveSquares({});
        return;
      }
      // Otherwise, select/deselect the clicked piece.
      highlightLegalMoves(square);
    },
    [selectedSquare, legalMoveSquares, fen, makeMove, highlightLegalMoves],
  );

  const onPieceClick = useCallback(
    (_piece: Piece, square: Square) => {
      // If a piece is already selected and we click a different own piece,
      // switch selection. If the target is an enemy piece that's a legal
      // capture target, execute the move.
      if (selectedSquare && legalMoveSquares[square]) {
        // This is a capture target — execute the move.
        makeMove(selectedSquare, square);
        setSelectedSquare(null);
        setLegalMoveSquares({});
        return;
      }
      highlightLegalMoves(square);
    },
    [selectedSquare, legalMoveSquares, makeMove, highlightLegalMoves],
  );

  // ─── Coach arrows ──────────────────────────────────────────────
  const customArrows = useMemo<Arrow[]>(() => {
    if (!lastMoveBestMoveBefore) return [];
    if (
      lastMoveQuality !== 'inaccuracy' &&
      lastMoveQuality !== 'mistake' &&
      lastMoveQuality !== 'blunder'
    ) {
      return [];
    }
    const from = lastMoveBestMoveBefore.slice(0, 2) as Square;
    const to = lastMoveBestMoveBefore.slice(2, 4) as Square;
    if (!from || !to || from === to) return [];
    return [[from, to, COACH_ARROW_COLOR]];
  }, [lastMoveQuality, lastMoveBestMoveBefore]);

  // ─── Square styles: last move highlight + legal move dots ──────
  const customSquareStyles = useMemo<CustomSquareStyles>(() => {
    const styles: CustomSquareStyles = {};
    // Last-move highlight.
    if (lastMoveFrom) styles[lastMoveFrom as Square] = LAST_MOVE_STYLE;
    if (lastMoveTo) styles[lastMoveTo as Square] = LAST_MOVE_STYLE;
    // Legal move dots (overlaid on top of last-move highlight).
    for (const [sq, style] of Object.entries(legalMoveSquares)) {
      styles[sq as Square] = { ...(styles[sq as Square] ?? {}), ...style };
    }
    return styles;
  }, [lastMoveFrom, lastMoveTo, legalMoveSquares]);

  // ─── Game-over headline ─────────────────────────────────────────
  let gameOverHeadline = 'Game Over';
  let gameOverSubtext = '';
  if (result === '1-0') {
    gameOverHeadline = 'White wins';
    gameOverSubtext = inCheck ? 'by checkmate' : '';
  } else if (result === '0-1') {
    gameOverHeadline = 'Black wins';
    gameOverSubtext = inCheck ? 'by checkmate' : '';
  } else if (result === '1/2-1/2') {
    gameOverHeadline = 'Draw';
    gameOverSubtext = 'by stalemate or repetition';
  }

  return (
    <div className="relative w-full max-w-[640px] aspect-square">
      <Chessboard
        position={fen}
        onPieceDrop={onPieceDrop}
        onPieceClick={onPieceClick}
        onSquareClick={onSquareClick}
        boardOrientation={orientation}
        customArrows={customArrows}
        customSquareStyles={customSquareStyles}
        customBoardStyle={{
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
        animationDuration={150}
        onPromotionCheck={isPromotionMove}
        onPromotionPieceSelect={onPromotionPieceSelect}
        promotionToSquare={promotionSquare}
        showPromotionDialog={showPromotion}
      />

      {/* Game-over modal overlay */}
      {showGameOverModal && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-xl bg-slate-900 px-8 py-6 shadow-2xl border border-slate-700">
            <h2 className="text-2xl font-bold text-slate-100">
              {gameOverHeadline}
            </h2>
            {gameOverSubtext && (
              <p className="text-sm text-slate-400">{gameOverSubtext}</p>
            )}
            {result && (
              <span className="font-mono text-lg text-slate-300">{result}</span>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { reset(); setGameOverDismissed(false); }}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                New game
              </button>
              <button
                type="button"
                onClick={() => setGameOverDismissed(true)}
                className="rounded-lg bg-slate-700 px-5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
              >
                Review game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
