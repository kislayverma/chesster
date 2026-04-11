/**
 * Phase 2 analysis layer.
 *
 * High-level API over the Stockfish Web Worker (stockfishWorker.ts).
 * Speaks UCI, buffers `info` lines, resolves on `bestmove`, and
 * serializes concurrent callers through an internal promise chain so
 * only one search runs at a time.
 *
 * Usage:
 *
 *   const res = await analyzePosition(fen, { depth: 15, skillLevel: 10 });
 *   console.log(res.bestMove, res.evalCp);
 *
 * The store uses `bestMove` both for Stockfish's own move (when it's
 * the engine's turn) and as the "try this line" suggestion for the
 * human's move. `evalCp` feeds the eval bar.
 */

import { send, subscribe } from './stockfishWorker';

export interface AnalyzeOptions {
  /** Search depth in plies. Defaults to 15 if neither depth nor movetime set. */
  depth?: number;
  /** Movetime in milliseconds. If set, overrides depth. */
  movetime?: number;
  /** Stockfish Skill Level, 0–20. 20 = full strength. */
  skillLevel?: number;
}

export interface AnalysisResult {
  /** Best move in UCI notation (e.g. "e2e4", "e7e8q"). "(none)" for mate/stalemate. */
  bestMove: string;
  /** Engine's ponder hint, if any. */
  ponder?: string;
  /** Centipawn eval from the moving side's perspective, or null if mate. */
  evalCp: number | null;
  /** Mate-in-N if applicable (positive = moving side mates), else null. */
  mate: number | null;
  /** Final search depth reached. */
  depth: number;
  /** Principal variation as UCI moves. */
  pv: string[];
}

interface PartialInfo {
  depth: number;
  evalCp: number | null;
  mate: number | null;
  pv: string[];
}

const UCI_OK = 'uciok';
const READY_OK = 'readyok';
const DEFAULT_DEPTH = 15;

let initPromise: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Fire-and-remember handshake. Sends `uci` and waits for `uciok`,
 * then `isready` and waits for `readyok`. Subsequent callers share
 * the same promise.
 */
function ensureReady(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = new Promise<void>((resolve) => {
    let sawUciOk = false;
    const unsubscribe = subscribe((line) => {
      if (!sawUciOk && line.includes(UCI_OK)) {
        sawUciOk = true;
        send('isready');
      } else if (sawUciOk && line.includes(READY_OK)) {
        unsubscribe();
        resolve();
      }
    });
    send('uci');
  });
  return initPromise;
}

/**
 * Run one UCI search. Assumes ensureReady() has resolved.
 * Parses `info` lines on the fly and resolves when `bestmove` arrives.
 */
function runSearch(fen: string, opts: AnalyzeOptions): Promise<AnalysisResult> {
  return new Promise<AnalysisResult>((resolve) => {
    const info: PartialInfo = { depth: 0, evalCp: null, mate: null, pv: [] };

    const unsubscribe = subscribe((line) => {
      if (line.startsWith('info ')) {
        parseInfoLine(line, info);
        return;
      }
      if (line.startsWith('bestmove ')) {
        unsubscribe();
        const parts = line.split(/\s+/);
        const bestMove = parts[1] ?? '(none)';
        const ponderIdx = parts.indexOf('ponder');
        const ponder = ponderIdx >= 0 ? parts[ponderIdx + 1] : undefined;
        resolve({
          bestMove,
          ponder,
          evalCp: info.evalCp,
          mate: info.mate,
          depth: info.depth,
          pv: info.pv.length > 0 ? info.pv : [bestMove],
        });
      }
    });

    if (opts.skillLevel != null) {
      const clamped = Math.max(0, Math.min(20, Math.round(opts.skillLevel)));
      send(`setoption name Skill Level value ${clamped}`);
    }

    send(`position fen ${fen}`);

    const limit =
      opts.movetime != null
        ? `movetime ${Math.max(1, Math.round(opts.movetime))}`
        : `depth ${Math.max(1, Math.round(opts.depth ?? DEFAULT_DEPTH))}`;
    send(`go ${limit}`);
  });
}

/**
 * Analyze a position. Requests are serialized through an internal
 * promise chain so the engine only runs one search at a time.
 * Callers that just want the latest eval can await this directly.
 */
export function analyzePosition(
  fen: string,
  opts: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const next = chain.then(async () => {
    await ensureReady();
    return runSearch(fen, opts);
  });
  // Keep the chain alive even if a caller throws.
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Tell the engine to start a new game. Stockfish uses this to clear
 * transposition tables and history heuristics between games.
 * Fire-and-forget.
 */
export function engineNewGame(): void {
  send('ucinewgame');
}

// ---------- UCI info line parsing ----------

const reDepth = /\bdepth (\d+)/;
const reScoreCp = /\bscore cp (-?\d+)/;
const reScoreMate = /\bscore mate (-?\d+)/;
const rePv = /\bpv (.+?)(?:\s+bmc\s|\s+info\s|$)/;

function parseInfoLine(line: string, info: PartialInfo): void {
  const d = line.match(reDepth);
  if (d) info.depth = parseInt(d[1], 10);

  const cp = line.match(reScoreCp);
  if (cp) {
    info.evalCp = parseInt(cp[1], 10);
    info.mate = null;
  }

  const mate = line.match(reScoreMate);
  if (mate) {
    info.mate = parseInt(mate[1], 10);
    info.evalCp = null;
  }

  const pv = line.match(rePv);
  if (pv) {
    info.pv = pv[1].trim().split(/\s+/);
  }
}
