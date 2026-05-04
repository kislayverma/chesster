/**
 * On-demand Stockfish analysis for imported games.
 *
 * Walks the mainline of a GameTree, runs Stockfish on each position
 * pair (parent FEN = "before", node FEN = "after"), classifies the
 * move quality, and tags motifs. Updates each MoveNode in place.
 *
 * Designed to be triggered from the GameReviewPage via an "Analyze
 * with Stockfish" button. Reports progress through a callback so the
 * UI can show a progress bar.
 */

import { analyzePosition, engineNewGame } from '../engine/analysis';
import { classifyMove } from './moveClassifier';
import { tagMove } from '../tagging/tagMove';
import { walkMainline, getNode, updateNode, type GameTree } from './gameTree';

export interface AnalysisProgress {
  /** 0-based index of the move currently being analyzed. */
  current: number;
  /** Total number of moves to analyze. */
  total: number;
}

const ANALYSIS_DEPTH = 15;

/**
 * Convert a side-to-move eval into white-perspective.
 * Stockfish returns eval from the perspective of the side to move;
 * classifyMove expects white-perspective values.
 */
function normalizeEval(
  rawCp: number | null,
  rawMate: number | null,
  sideToMove: 'w' | 'b',
): { evalCp: number | null; mate: number | null } {
  const sign = sideToMove === 'w' ? 1 : -1;
  return {
    evalCp: rawCp != null ? rawCp * sign : null,
    mate: rawMate != null ? rawMate * sign : null,
  };
}

/**
 * Determine which side is to move in a FEN string.
 */
function sideToMove(fen: string): 'w' | 'b' {
  const parts = fen.split(/\s+/);
  return parts[1] === 'b' ? 'b' : 'w';
}

/**
 * Check whether the mainline has already been analyzed.
 * Returns true if every non-root mainline node has a non-null quality.
 */
export function isTreeAnalyzed(tree: GameTree): boolean {
  let first = true;
  for (const node of walkMainline(tree)) {
    if (first) { first = false; continue; } // skip root
    if (node.quality === null && node.evalCp === null && node.mate === null) {
      return false;
    }
  }
  return true;
}

/**
 * Analyze every mainline move in the tree with Stockfish.
 *
 * Mutates the tree's MoveNodes in place. Calls `onProgress` after
 * each move is analyzed. Can be aborted via `signal`.
 *
 * Returns the number of moves analyzed.
 */
export async function analyzeImportedGame(
  tree: GameTree,
  onProgress?: (p: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  // Collect mainline nodes (skip root).
  const mainline: string[] = [];
  for (const node of walkMainline(tree)) {
    if (node.parentId !== null) {
      mainline.push(node.id);
    }
  }

  if (mainline.length === 0) return 0;

  engineNewGame();

  // We need "eval before" for the first move, so analyze the root position first.
  const root = getNode(tree, tree.rootId);
  const rootSide = sideToMove(root.fen);
  const rootAnalysis = await analyzePosition(root.fen, { depth: ANALYSIS_DEPTH });
  if (signal?.aborted) return 0;

  const rootNorm = normalizeEval(rootAnalysis.evalCp, rootAnalysis.mate, rootSide);

  // Store eval on the root node for the eval chart.
  updateNode(tree, root.id, {
    evalCp: rootNorm.evalCp,
    mate: rootNorm.mate,
  });

  let prevEvalCp = rootNorm.evalCp;
  let prevEvalMate = rootNorm.mate;
  let prevBestMove = rootAnalysis.bestMove;

  let analyzed = 0;

  for (let i = 0; i < mainline.length; i++) {
    if (signal?.aborted) break;

    const nodeId = mainline[i];
    const node = getNode(tree, nodeId);

    // Analyze the position AFTER this move (the node's FEN).
    const afterSide = sideToMove(node.fen);
    const afterResult = await analyzePosition(node.fen, { depth: ANALYSIS_DEPTH });
    if (signal?.aborted) break;

    const afterNorm = normalizeEval(afterResult.evalCp, afterResult.mate, afterSide);

    // Classify the move: eval before vs eval after (both white-perspective).
    const classification = classifyMove({
      evalBeforeCp: prevEvalCp,
      evalBeforeMate: prevEvalMate,
      evalAfterCp: afterNorm.evalCp,
      evalAfterMate: afterNorm.mate,
      moverColor: node.moverColor as 'w' | 'b',
    });

    // Tag motifs using rule detectors (+ optional LLM).
    const parentNode = getNode(tree, node.parentId!);
    const motifs = await tagMove({
      fenBefore: parentNode.fen,
      fenAfter: node.fen,
      playerMoveUci: node.uci,
      bestMoveBeforeUci: prevBestMove !== '(none)' ? prevBestMove : null,
      evalBeforeCp: prevEvalCp,
      evalBeforeMate: prevEvalMate,
      evalAfterCp: afterNorm.evalCp,
      evalAfterMate: afterNorm.mate,
      pvAfter: afterResult.pv,
      moverColor: node.moverColor as 'w' | 'b',
      quality: classification.quality,
    });

    // Update the node with analysis results.
    updateNode(tree, nodeId, {
      evalCp: afterNorm.evalCp,
      mate: afterNorm.mate,
      bestMoveBeforeUci: prevBestMove !== '(none)' ? prevBestMove : null,
      quality: classification.quality,
      cpLoss: classification.cpLoss,
      motifs,
    });

    // Shift: this node's "after" eval becomes next node's "before" eval.
    prevEvalCp = afterNorm.evalCp;
    prevEvalMate = afterNorm.mate;
    prevBestMove = afterResult.bestMove;

    analyzed += 1;
    onProgress?.({ current: analyzed, total: mainline.length });
  }

  return analyzed;
}
