// Copies the Stockfish.js lite single-threaded build from node_modules
// into public/stockfish/ so Vite can serve it as a static asset.
//
// The single-threaded lite build is chosen because it:
//   • is ~7MB (vs ~113MB for the full NNUE build)
//   • does not need SharedArrayBuffer, so no COOP/COEP headers
//   • is still vastly stronger than any human
//
// Runs automatically via `postinstall` in package.json.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'node_modules/stockfish/bin');
const dst = resolve(root, 'public/stockfish');

if (!existsSync(src)) {
  console.warn(
    '[vendor-stockfish] node_modules/stockfish/bin not found. ' +
      'Skipping vendor step — did you forget `npm install`?'
  );
  process.exit(0);
}

mkdirSync(dst, { recursive: true });

const files = [
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
];

for (const f of files) {
  const from = resolve(src, f);
  const to = resolve(dst, f);
  cpSync(from, to);
  console.log(`[vendor-stockfish] ${f}`);
}

// GPLv3 license text alongside the binaries.
const license = resolve(root, 'node_modules/stockfish/Copying.txt');
if (existsSync(license)) {
  cpSync(license, resolve(dst, 'Copying.txt'));
  console.log('[vendor-stockfish] Copying.txt');
}

console.log('[vendor-stockfish] Done → public/stockfish/');
