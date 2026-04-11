#!/usr/bin/env node
/**
 * Slice the SBS 2D Chess Pack Marble tilesets into individual
 * PNG sprites that the `react-chessboard` `customPieces` prop can
 * consume.
 *
 * Input  (raw, excluded from deploys via .vercelignore):
 *   SBS - 2D Chess Pack/Top Down/Pieces/White/White - Marble 1 128x128.png
 *   SBS - 2D Chess Pack/Top Down/Pieces/Black/Black - Marble 1 128x128.png
 *   SBS - 2D Chess Pack/Top Down/Tiles/Marble 1 TD 64x72.png
 *
 * Output (committed under public/, served at /pieces and /squares):
 *   public/pieces/marble/white/{king,queen,rook,bishop,knight,pawn}.png
 *   public/pieces/marble/black/{king,queen,rook,bishop,knight,pawn}.png
 *   public/squares/marble/{light,dark}.png
 *
 * The tile index mapping was decoded from
 * `SBS - 2D Chess Pack/Top Down/Top-Down Example.tmx`, which places
 * a reference back-rank for each material. The 4x4 piece sheets
 * carry 16 tiles (6 piece types + variants). The mapping is:
 *
 *   Queen  = local 8   (col 0, row 2)
 *   King   = local 10  (col 2, row 2)
 *   Rook   = local 11  (col 3, row 2)
 *   Pawn   = local 12  (col 0, row 3)
 *   Bishop = local 1 for white, local 2 for black (row 0)
 *   Knight = local 5 for white, local 6 for black (row 1)
 *
 * The square sheets are 4 cols x 2 rows of 64x72 tiles. Locals 0-3
 * are the four dark variants, 4-7 are the four light variants (also
 * confirmed from the tmx). We pick local 0 / local 4 and crop the
 * top 64 pixels so the 8-pixel bottom shadow bleed doesn't get
 * stretched when react-chessboard renders these as square cells.
 *
 * Re-runs are idempotent — every file is overwritten every time.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const sbsRoot = join(repoRoot, 'SBS - 2D Chess Pack', 'Top Down');
const outPieces = join(repoRoot, 'public', 'pieces', 'marble');
const outSquares = join(repoRoot, 'public', 'squares', 'marble');

const PIECE_TILE = 128;
const SQUARE_TILE_W = 64;
const SQUARE_TILE_H = 72;
const SQUARE_VISIBLE_H = 64; // strip the 8-pixel bottom shadow bleed

/**
 * Local tile index → (col, row) in a 4-column grid.
 */
function localToColRow(local, cols = 4) {
  return { col: local % cols, row: Math.floor(local / cols) };
}

/**
 * The SBS piece spritesheets ship with a solid background colour
 * that Tiled removes via its `trans` key. Sharp doesn't honour that
 * metadata, so we recreate the alpha mask manually per sheet:
 *
 *   White - Marble 1 128x128.png  → bg rgb(  0,   0,   0)
 *   Black - Marble 1 128x128.png  → bg rgb(  0, 128, 128)
 *
 * Any pixel within `KEY_TOLERANCE` of the expected bg (per channel)
 * becomes fully transparent; everything else stays opaque.
 */
const KEY_TOLERANCE = 6;

async function extractPiece(sourcePath, local, outPath, keyRgb) {
  const { col, row } = localToColRow(local);
  const { data, info } = await sharp(sourcePath)
    .extract({
      left: col * PIECE_TILE,
      top: row * PIECE_TILE,
      width: PIECE_TILE,
      height: PIECE_TILE,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const [kr, kg, kb] = keyRgb;
  const rgba = Buffer.from(data);
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      Math.abs(rgba[i] - kr) <= KEY_TOLERANCE &&
      Math.abs(rgba[i + 1] - kg) <= KEY_TOLERANCE &&
      Math.abs(rgba[i + 2] - kb) <= KEY_TOLERANCE
    ) {
      rgba[i + 3] = 0;
    }
  }

  const buf = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  await writeFile(outPath, buf);
  return outPath;
}

async function extractSquare(sourcePath, local, outPath) {
  // Square tiles are 64x72 in a 4-col grid, but we crop to 64x64 so
  // react-chessboard can render them on square cells without
  // vertical distortion.
  const { col, row } = localToColRow(local);
  const buf = await sharp(sourcePath)
    .extract({
      left: col * SQUARE_TILE_W,
      top: row * SQUARE_TILE_H,
      width: SQUARE_TILE_W,
      height: SQUARE_VISIBLE_H,
    })
    .png()
    .toBuffer();
  await writeFile(outPath, buf);
  return outPath;
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function main() {
  if (!existsSync(sbsRoot)) {
    console.error(`[slice-chess-assets] source folder not found: ${sbsRoot}`);
    process.exit(1);
  }

  await ensureDir(join(outPieces, 'white'));
  await ensureDir(join(outPieces, 'black'));
  await ensureDir(outSquares);

  const whiteSheet = join(sbsRoot, 'Pieces', 'White', 'White - Marble 1 128x128.png');
  const blackSheet = join(sbsRoot, 'Pieces', 'Black', 'Black - Marble 1 128x128.png');
  const tileSheet = join(sbsRoot, 'Tiles', 'Marble 1 TD 64x72.png');

  for (const p of [whiteSheet, blackSheet, tileSheet]) {
    if (!existsSync(p)) {
      console.error(`[slice-chess-assets] missing input: ${p}`);
      process.exit(1);
    }
  }

  // White pieces — uses bishop variant A (local 1) and knight
  // variant A (local 5) as its back rank does in the SBS example.
  const whitePlan = [
    { name: 'king', local: 10 },
    { name: 'queen', local: 8 },
    { name: 'rook', local: 11 },
    { name: 'bishop', local: 1 },
    { name: 'knight', local: 5 },
    { name: 'pawn', local: 12 },
  ];
  // Black pieces — uses the mirrored variants (local 2, local 6).
  const blackPlan = [
    { name: 'king', local: 10 },
    { name: 'queen', local: 8 },
    { name: 'rook', local: 11 },
    { name: 'bishop', local: 2 },
    { name: 'knight', local: 6 },
    { name: 'pawn', local: 12 },
  ];

  const written = [];

  const whiteKey = [0, 0, 0];
  const blackKey = [0, 128, 128];

  for (const { name, local } of whitePlan) {
    const out = join(outPieces, 'white', `${name}.png`);
    await extractPiece(whiteSheet, local, out, whiteKey);
    written.push(out);
  }
  for (const { name, local } of blackPlan) {
    const out = join(outPieces, 'black', `${name}.png`);
    await extractPiece(blackSheet, local, out, blackKey);
    written.push(out);
  }

  // Squares: local 0 (dark variant A), local 4 (light variant A).
  const darkOut = join(outSquares, 'dark.png');
  const lightOut = join(outSquares, 'light.png');
  await extractSquare(tileSheet, 0, darkOut);
  await extractSquare(tileSheet, 4, lightOut);
  written.push(darkOut, lightOut);

  console.log(`[slice-chess-assets] wrote ${written.length} files:`);
  for (const p of written) {
    console.log(`  ${p.replace(repoRoot + '/', '')}`);
  }
}

main().catch((err) => {
  console.error('[slice-chess-assets] failed:', err);
  process.exit(1);
});
