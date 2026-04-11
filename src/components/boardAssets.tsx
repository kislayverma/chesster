/**
 * Shared visual assets for `react-chessboard` driven boards.
 *
 * We use the Marble set extracted from the SBS 2D Chess Pack
 * (CC0 1.0 Universal). The raw spritesheets live under
 * `SBS - 2D Chess Pack/` at the repo root (ignored by deploys) and
 * are sliced into individual PNGs under `public/pieces/marble/` and
 * `public/squares/marble/` by `scripts/slice-chess-assets.mjs`
 * (`npm run assets:chess`). Because everything is served from
 * `public/`, the URLs below are stable root-relative paths that
 * Vite will copy into `dist/` unchanged.
 *
 * Consumed by `Board.tsx` (the live board) and `MiniBoard.tsx` (the
 * StackPanel preview). Both pass these objects straight into
 * `customPieces`, `customLightSquareStyle`, and
 * `customDarkSquareStyle`.
 */
import type { ReactElement } from 'react';

// Piece key shape used by react-chessboard.
type PieceKey =
  | 'wP'
  | 'wN'
  | 'wB'
  | 'wR'
  | 'wQ'
  | 'wK'
  | 'bP'
  | 'bN'
  | 'bB'
  | 'bR'
  | 'bQ'
  | 'bK';

type PieceRenderer = (args: { squareWidth: number }) => ReactElement;

const PIECE_URLS: Record<PieceKey, string> = {
  wP: '/pieces/marble/white/pawn.png',
  wN: '/pieces/marble/white/knight.png',
  wB: '/pieces/marble/white/bishop.png',
  wR: '/pieces/marble/white/rook.png',
  wQ: '/pieces/marble/white/queen.png',
  wK: '/pieces/marble/white/king.png',
  bP: '/pieces/marble/black/pawn.png',
  bN: '/pieces/marble/black/knight.png',
  bB: '/pieces/marble/black/bishop.png',
  bR: '/pieces/marble/black/rook.png',
  bQ: '/pieces/marble/black/queen.png',
  bK: '/pieces/marble/black/king.png',
};

function makeRenderer(url: string): PieceRenderer {
  return function MarblePiece({ squareWidth }) {
    return (
      <div
        style={{
          width: squareWidth,
          height: squareWidth,
          backgroundImage: `url(${url})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          // Let the square's own background image show through the
          // keyed-out areas of the sprite.
          pointerEvents: 'none',
        }}
      />
    );
  };
}

/**
 * Map of react-chessboard piece codes to render functions. Pass this
 * into the `customPieces` prop.
 */
export const marbleCustomPieces: Record<PieceKey, PieceRenderer> = Object.fromEntries(
  (Object.keys(PIECE_URLS) as PieceKey[]).map((key) => [key, makeRenderer(PIECE_URLS[key])]),
) as Record<PieceKey, PieceRenderer>;

/**
 * Square background styles pointing at the sliced marble tiles.
 * Pass into `customLightSquareStyle` / `customDarkSquareStyle`.
 *
 * `backgroundSize: 100% 100%` deliberately stretches the 64x64 PNG
 * to fill whatever cell size the board computes.
 */
export const marbleLightSquareStyle: Record<string, string> = {
  backgroundImage: 'url(/squares/marble/light.png)',
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

export const marbleDarkSquareStyle: Record<string, string> = {
  backgroundImage: 'url(/squares/marble/dark.png)',
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};
