/**
 * PGN import — converts a PGN string into a GameTree.
 *
 * Uses chess.js to validate moves and extract FEN/UCI for each ply.
 * The resulting tree has all analysis fields set to null — the user
 * can run on-demand Stockfish analysis from the review page.
 */

import { Chess } from 'chess.js';
import {
  createTree,
  addChild,
  extendFrame,
  STARTING_FEN,
} from './gameTree';
import type { GameTree, GameSource, ImportMetadata } from './gameTree';

/** Headers parsed from a PGN string. */
export interface PgnHeaders {
  event?: string;
  site?: string;
  date?: string;
  white?: string;
  black?: string;
  result?: string;
  whiteElo?: string;
  blackElo?: string;
  timeControl?: string;
  eco?: string;
  /** Raw FEN if the game started from a non-standard position. */
  fen?: string;
  /** Any remaining headers as key-value pairs. */
  [key: string]: string | undefined;
}

/** Result of importing a single PGN game. */
export interface PgnImportResult {
  tree: GameTree;
  headers: PgnHeaders;
}

// -----------------------------------------------------------------------
// Header parsing
// -----------------------------------------------------------------------

const HEADER_RE = /\[(\w+)\s+"([^"]*)"\]/g;

export function parsePgnHeaders(pgn: string): PgnHeaders {
  const headers: PgnHeaders = {};
  let match: RegExpExecArray | null;
  while ((match = HEADER_RE.exec(pgn)) !== null) {
    const key = match[1];
    const value = match[2];
    // Map standard PGN tags to our camelCase keys.
    switch (key) {
      case 'Event':       headers.event = value; break;
      case 'Site':        headers.site = value; break;
      case 'Date':        headers.date = value; break;
      case 'White':       headers.white = value; break;
      case 'Black':       headers.black = value; break;
      case 'Result':      headers.result = value; break;
      case 'WhiteElo':    headers.whiteElo = value; break;
      case 'BlackElo':    headers.blackElo = value; break;
      case 'TimeControl':
      case 'Timecontrol': headers.timeControl = value; break;
      case 'ECO':         headers.eco = value; break;
      case 'FEN':         headers.fen = value; break;
      default:            headers[key.toLowerCase()] = value;
    }
  }
  return headers;
}

// -----------------------------------------------------------------------
// PGN → GameTree
// -----------------------------------------------------------------------

/**
 * Parse a PGN string and build a GameTree from its mainline moves.
 *
 * Throws if the PGN is unparseable or contains illegal moves.
 */
export function importPgnToTree(pgn: string): PgnImportResult {
  const headers = parsePgnHeaders(pgn);

  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    throw new Error('Failed to parse PGN');
  }

  // Extract the move history with full detail (from, to, san, etc.).
  const moves = chess.history({ verbose: true });

  // Determine starting FEN (support games that start from a position).
  const startingFen = headers.fen ?? STARTING_FEN;

  // Create the tree.
  const tree = createTree(startingFen);

  // Map PGN result string to our union type.
  if (headers.result === '1-0' || headers.result === '0-1' || headers.result === '1/2-1/2') {
    tree.result = headers.result;
  }

  // Parse date to epoch if available.
  if (headers.date) {
    const parsed = parsePgnDate(headers.date);
    if (parsed) tree.startedAt = parsed;
  }

  // Walk through moves and build the tree.
  const mainFrameId = tree.stackFrames[0].id;
  let currentNodeId = tree.rootId;

  for (const move of moves) {
    const uci = move.from + move.to + (move.promotion ?? '');
    const node = addChild(tree, currentNodeId, {
      move: move.san,
      uci,
      fen: move.after,
      moverColor: move.color,
      evalCp: null,
      mate: null,
      bestMoveBeforeUci: null,
      quality: null,
      motifs: [],
      coachText: null,
      coachSource: null,
      cpLoss: null,
    });
    extendFrame(tree, mainFrameId, node.id);
    currentNodeId = node.id;
  }

  tree.currentNodeId = currentNodeId;

  return { tree, headers };
}

// -----------------------------------------------------------------------
// Metadata helpers
// -----------------------------------------------------------------------

/**
 * Build an ImportMetadata object from parsed PGN headers and platform info.
 */
export function buildImportMetadata(
  headers: PgnHeaders,
  source: GameSource,
  externalId?: string,
  playedAt?: number,
): ImportMetadata {
  return {
    source,
    externalId,
    whitePlayer: headers.white,
    blackPlayer: headers.black,
    whiteElo: headers.whiteElo ? parseInt(headers.whiteElo, 10) || undefined : undefined,
    blackElo: headers.blackElo ? parseInt(headers.blackElo, 10) || undefined : undefined,
    timeControl: headers.timeControl,
    playedAt: playedAt ?? (headers.date ? parsePgnDate(headers.date) ?? undefined : undefined),
  };
}

/**
 * Determine which color the linked user played based on username match
 * against the PGN White/Black headers.
 */
export function determineHumanColor(
  headers: PgnHeaders,
  linkedUsername: string,
): 'w' | 'b' {
  const lower = linkedUsername.toLowerCase();
  if (headers.white?.toLowerCase() === lower) return 'w';
  if (headers.black?.toLowerCase() === lower) return 'b';
  // Default to white if no match (e.g. name mismatch).
  return 'w';
}

/**
 * Parse a PGN date string like "2025.04.12" into epoch ms.
 * Returns null if the date is unrecognizable or "????.??.??".
 */
function parsePgnDate(dateStr: string): number | null {
  if (dateStr.includes('?')) return null;
  // PGN dates use "." separators: YYYY.MM.DD
  const normalized = dateStr.replace(/\./g, '-');
  const ms = Date.parse(normalized);
  return isNaN(ms) ? null : ms;
}
