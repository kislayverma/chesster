/**
 * Phase 12 PGN export.
 *
 * Produces a PGN string from a `GameTree`, including variations
 * encoded as RAV (Recursive Annotation Variations). The mainline
 * follows `childrenIds[0]` at every node; additional children become
 * parenthesised sub-lines.
 *
 * Example output:
 *
 *   [Event "altmove Game"]
 *   [Date "2025.04.12"]
 *   [White "Human"]
 *   [Black "Stockfish"]
 *   [Result "1-0"]
 *
 *   1. e4 e5 2. Nf3 (2. Bc4 Nc6) 2... Nc6 3. Bb5 *
 *
 * The caller can specify human colour so we know which tag gets
 * "Human" and which gets "Stockfish".
 */

import type { GameTree, MoveNode } from './gameTree';

interface PgnOptions {
  humanColor?: 'w' | 'b';
  event?: string;
}

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function headerTag(key: string, value: string): string {
  return `[${key} "${value.replace(/"/g, '\\"')}"]`;
}

/**
 * Recursively walk a subtree rooted at `node` and emit PGN tokens
 * (SAN moves, move numbers, RAV parentheses) into `out`.
 */
function walkNode(
  tree: GameTree,
  node: MoveNode,
  out: string[],
  forceNumber: boolean,
): void {
  // Emit the move itself (root has no SAN).
  if (node.parentId !== null && node.move) {
    const fullMove = Math.ceil(node.ply / 2);
    const isWhite = node.moverColor === 'w';

    if (isWhite || forceNumber) {
      out.push(isWhite ? `${fullMove}.` : `${fullMove}...`);
    }
    out.push(node.move);
  }

  const children = node.childrenIds
    .map((id) => tree.nodes.get(id))
    .filter((n): n is MoveNode => n != null);

  if (children.length === 0) return;

  // First child is the continuation of the current line.
  const main = children[0];

  // Side-lines (child index 1+) become RAV sub-variations.
  for (let i = 1; i < children.length; i++) {
    out.push('(');
    walkNode(tree, children[i], out, true);
    out.push(')');
  }

  // Continue with the main child. Force a move number after a RAV
  // bracket so the reader knows where we are.
  walkNode(tree, main, out, children.length > 1);
}

/**
 * Export a `GameTree` to PGN. Returns a complete PGN string
 * (headers + movetext + result terminator).
 */
export function exportPgn(tree: GameTree, options: PgnOptions = {}): string {
  const { humanColor = 'w', event = 'altmove Game' } = options;

  const white = humanColor === 'w' ? 'Human' : 'Stockfish';
  const black = humanColor === 'b' ? 'Human' : 'Stockfish';
  const result = tree.result ?? '*';

  const headers = [
    headerTag('Event', event),
    headerTag('Site', 'altmove'),
    headerTag('Date', formatDate(tree.startedAt)),
    headerTag('White', white),
    headerTag('Black', black),
    headerTag('Result', result),
  ];

  const root = tree.nodes.get(tree.rootId);
  if (!root) return headers.join('\n') + '\n\n' + result + '\n';

  const tokens: string[] = [];
  walkNode(tree, root, tokens, true);
  tokens.push(result);

  // Wrap the movetext at ~80 chars per line for readability.
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    if (line.length > 0 && line.length + 1 + tok.length > 80) {
      lines.push(line);
      line = tok;
    } else {
      line = line ? `${line} ${tok}` : tok;
    }
  }
  if (line) lines.push(line);

  return headers.join('\n') + '\n\n' + lines.join('\n') + '\n';
}
