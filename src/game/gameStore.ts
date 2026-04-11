/**
 * Phase 4 game store — tree-backed state + Stockfish opponent + coaching pipeline.
 *
 * Phase 3 used a flat chess.js history. Phase 4 replaces that with a
 * proper game tree (see gameTree.ts) so the user can fork off any
 * move, try an alternative line, and pop back to the real game
 * without losing a thing.
 *
 * Key differences vs the Phase 3 store:
 *
 *   • No long-lived `chess: Chess` instance. The source of truth is
 *     `tree.currentNodeId`, and the displayed position is derived
 *     from that node's FEN. A fresh `new Chess(fen)` is spun up for
 *     any operation that needs move generation.
 *
 *   • `makeMove` now branches: extending the mainline if
 *     (no exploration) and (current = mainGameHead), otherwise
 *     creating/reusing an exploration branch.
 *
 *   • New actions:
 *       - goToNode(id)        — navigate without modifying the tree
 *       - tryThisLine()       — fork and replay with engine's bestMove
 *       - returnToMainGame()  — jump back to mainGameHead
 *       - dismissForkError()  — clear the fork-blocked banner
 *
 *   • Anonymous users are capped at MAX_ANON_BRANCHES exploration
 *     branches rooted on the mainline (DESIGN.md §12b). Attempts to
 *     create more set `forkBlockedReason` for a few seconds.
 *
 *   • `history` is kept on the store as a convenience (path from
 *     root to current, excluding root) so App.tsx can enable/disable
 *     Undo and MoveList can walk the current path.
 *
 * Engine auto-play still only runs after a human move — not after
 * navigation — so browsing the tree never triggers Stockfish.
 */

import { Chess } from 'chess.js';
import { create } from 'zustand';
import { analyzePosition, engineNewGame } from '../engine/analysis';
import {
  classifyMove,
  type MoveQuality,
} from './moveClassifier';
import { detectPhase } from '../tagging/phaseDetector';
import { tagMove } from '../tagging/tagMove';
import { getCoachExplanation } from '../coach/coachClient';
import type { MotifId } from '../tagging/motifs';
import {
  createTree,
  getNode,
  addChild,
  findChildBySan,
  updateNode,
  findBranchRoot,
  pathFromRoot,
  walkMainline,
  type GameTree,
  type MoveNode,
} from './gameTree';
import {
  MAX_ANON_BRANCHES,
  countExplorationBranches,
} from '../lib/branchLimit';
import { useProfileStore } from '../profile/profileStore';
import type { WeaknessEvent } from '../profile/types';
import { saveGame } from './gameStorage';

/**
 * Module-level set so a single tree is "finished" at most once, even
 * if the player clicks around the position after the last move.
 */
const finishedGameIds = new Set<string>();

/** Walk the mainline and average cpLoss over the human player's moves. */
function computeMainlineAcpl(tree: GameTree, humanColor: 'w' | 'b'): number {
  let sum = 0;
  let n = 0;
  for (const node of walkMainline(tree)) {
    if (
      node.parentId !== null &&
      node.moverColor === humanColor &&
      node.cpLoss !== null &&
      node.quality !== 'book'
    ) {
      sum += Math.max(0, node.cpLoss);
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Fire-and-forget tree save; errors are swallowed inside gameStorage. */
function persistTree(
  tree: GameTree,
  humanColor: 'w' | 'b',
  engineEnabled: boolean,
  finishedAt: number | null = null
): void {
  void saveGame({ tree, humanColor, engineEnabled, finishedAt });
}

/**
 * Called after every tree mutation. If the mainline head is game-over
 * and this game has not yet been marked finished, record an ACPL
 * sample on the profile and save the game with a `finishedAt` stamp.
 * Idempotent via `finishedGameIds`.
 */
function maybeFinishMainGame(
  tree: GameTree,
  humanColor: 'w' | 'b',
  engineEnabled: boolean
): void {
  if (finishedGameIds.has(tree.id)) return;
  const headNode = tree.nodes.get(tree.mainGameHeadId);
  if (!headNode) return;
  const headChess = new Chess(headNode.fen);
  if (!headChess.isGameOver()) return;

  finishedGameIds.add(tree.id);

  // Sync the tree.result marker so persisted games show the outcome.
  let result: GameTree['result'] = null;
  if (headChess.isCheckmate()) {
    result = headChess.turn() === 'w' ? '0-1' : '1-0';
  } else if (
    headChess.isDraw() ||
    headChess.isStalemate() ||
    headChess.isThreefoldRepetition()
  ) {
    result = '1/2-1/2';
  }
  tree.result = result;

  const acpl = computeMainlineAcpl(tree, humanColor);
  useProfileStore.getState().finishGame(acpl);
  persistTree(tree, humanColor, engineEnabled, Date.now());
}

export interface GameSnapshot {
  fen: string;
  turn: 'w' | 'b';
  isGameOver: boolean;
  inCheck: boolean;
  result: '1-0' | '0-1' | '1/2-1/2' | null;
}

export interface EngineState {
  /** True while Stockfish is searching the current position. */
  thinking: boolean;
  /** Engine evaluation from WHITE's perspective in centipawns, or null if mate. */
  evalCp: number | null;
  /** Mate-in-N from WHITE's perspective (positive = white mates), or null. */
  mate: number | null;
  /** Engine's current top move suggestion in UCI (e.g. "e2e4"). */
  lastBestMove: string | null;
  /** Final search depth that produced the current eval. */
  evalDepth: number;
}

export interface EngineSettings {
  /** Whether Stockfish auto-plays when it's its turn. */
  engineEnabled: boolean;
  /** Which color the human controls. */
  humanColor: 'w' | 'b';
  /** Stockfish `Skill Level` option, 0–20. */
  skillLevel: number;
  /** Search depth for the engine's own moves AND for coaching eval. */
  searchDepth: number;
}

/**
 * Coach state — the most recent human move's classification, motifs,
 * and rendered explanation. Populated by the analysis callback and
 * also cached on the destination node (so navigating back restores
 * the coach panel without re-running the pipeline).
 */
export interface CoachState {
  lastMoveQuality: MoveQuality | null;
  lastMoveMotifs: MotifId[];
  lastMoveCoachText: string | null;
  lastMoveCoachSource: 'llm' | 'template' | null;
  lastMoveCpLoss: number | null;
  /** Pre-move engine best move in UCI — used by the "Try this line" button. */
  lastMoveBestMoveBefore: string | null;
}

export interface TreeState {
  tree: GameTree;
  currentNodeId: string;
  mainGameHeadId: string;
  explorationRootId: string | null;
  /**
   * Transient error message for the ForkBanner when a branch creation
   * is rejected (typically the MAX_ANON_BRANCHES cap). Auto-clears
   * after a few seconds.
   */
  forkBlockedReason: string | null;
  /** Path from root to currentNodeId, excluding root. */
  history: MoveNode[];
}

interface GameStore
  extends GameSnapshot,
    EngineState,
    EngineSettings,
    CoachState,
    TreeState {
  /** Attempt a move from the current position. Returns true if applied. */
  makeMove: (from: string, to: string, promotion?: string) => boolean;

  /** Navigate the board to any node in the tree. */
  goToNode: (nodeId: string) => void;

  /**
   * Fork at the parent of the current node and play the engine's
   * bestMove instead. No-op if we don't have a cached bestMove or if
   * the anon branch cap has been reached.
   */
  tryThisLine: () => void;

  /** Jump back to the real game's head. Preserves the branch in the tree. */
  returnToMainGame: () => void;

  /** Manually dismiss the fork-blocked error banner. */
  dismissForkError: () => void;

  /** Start a fresh game (discards the current tree). */
  reset: () => void;

  /**
   * Undo the most recent move — move currentNode to parent, or to
   * grandparent when playing against the engine. Does NOT mutate the
   * tree; other branches are still reachable via MoveList.
   */
  undo: () => void;

  setEngineEnabled: (on: boolean) => void;
  setHumanColor: (color: 'w' | 'b') => void;
  setSkillLevel: (level: number) => void;
}

// ---------- helpers ----------

function snapshotFromFen(fen: string): GameSnapshot {
  const chess = new Chess(fen);
  let result: GameSnapshot['result'] = null;
  if (chess.isGameOver()) {
    if (chess.isCheckmate()) {
      result = chess.turn() === 'w' ? '0-1' : '1-0';
    } else if (
      chess.isDraw() ||
      chess.isStalemate() ||
      chess.isThreefoldRepetition()
    ) {
      result = '1/2-1/2';
    }
  }
  return {
    fen,
    turn: chess.turn() as 'w' | 'b',
    isGameOver: chess.isGameOver(),
    inCheck: chess.inCheck(),
    result,
  };
}

/**
 * Convert an analysis result's side-to-move eval into one normalized
 * to WHITE's perspective (positive = good for white).
 */
function normalizeEval(
  rawCp: number | null,
  rawMate: number | null,
  sideToMove: 'w' | 'b'
): { evalCp: number | null; mate: number | null } {
  const sign = sideToMove === 'w' ? 1 : -1;
  return {
    evalCp: rawCp != null ? rawCp * sign : null,
    mate: rawMate != null ? rawMate * sign : null,
  };
}

/** Convert a UCI move to SAN against a given position. */
function uciToSan(uci: string, fen: string): string {
  try {
    const clone = new Chess(fen);
    const parsed = clone.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length >= 5 ? uci[4] : undefined,
    });
    return parsed ? parsed.san : uci;
  } catch {
    return uci;
  }
}

const EMPTY_COACH_STATE: CoachState = {
  lastMoveQuality: null,
  lastMoveMotifs: [],
  lastMoveCoachText: null,
  lastMoveCoachSource: null,
  lastMoveCpLoss: null,
  lastMoveBestMoveBefore: null,
};

/**
 * Build the slice of store state that represents "we are now viewing
 * node X". Merges tree pointers, board snapshot, and any cached
 * coach payload on the node.
 */
function navState(
  tree: GameTree,
  nodeId: string
): TreeState & GameSnapshot & CoachState {
  const node = getNode(tree, nodeId);
  const branch = findBranchRoot(tree, nodeId);
  return {
    tree,
    currentNodeId: nodeId,
    mainGameHeadId: tree.mainGameHeadId,
    explorationRootId: branch ? branch.id : null,
    forkBlockedReason: null,
    history: pathFromRoot(tree, nodeId).slice(1),
    ...snapshotFromFen(node.fen),
    lastMoveQuality: node.quality,
    lastMoveMotifs: node.motifs,
    lastMoveCoachText: node.coachText,
    lastMoveCoachSource: node.coachSource,
    lastMoveCpLoss: node.cpLoss,
    lastMoveBestMoveBefore: node.bestMoveBeforeUci,
  };
}

/** Parse UCI into a chess.js-compatible move object. */
function parseUci(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length >= 5 ? uci[4] : undefined,
  };
}

/** Context captured at the moment a human move is played. */
interface HumanMoveContext {
  nodeId: string;
  fenBefore: string;
  playerMoveUci: string;
  playerMoveSan: string;
  bestMoveBeforeUci: string | null;
  evalBeforeCp: number | null;
  evalBeforeMate: number | null;
  moverColor: 'w' | 'b';
}

// ---------- store ----------

export const useGameStore = create<GameStore>((set, get) => {
  const initialTree = createTree();

  /**
   * Monotonically increasing counter stamped on every position change.
   * When an async analysis resolves, we check that the counter still
   * matches — if not, the result is stale (user undid, reset, jumped,
   * etc.) and we drop it silently.
   */
  let analysisSeq = 0;

  /**
   * Like `kickAnalysis` but never auto-plays and never coaches. Used
   * on navigation so Stockfish doesn't start pushing pieces on a
   * position the user is only reviewing.
   */
  const kickObservation = (
    fen: string,
    sideToMove: 'w' | 'b',
    seq: number
  ): void => {
    if (seq !== analysisSeq) return;
    set({ thinking: true });
    const { skillLevel, searchDepth } = get();
    analyzePosition(fen, { depth: searchDepth, skillLevel })
      .then((result) => {
        if (seq !== analysisSeq) return;
        const { evalCp, mate } = normalizeEval(
          result.evalCp,
          result.mate,
          sideToMove
        );
        set({
          thinking: false,
          evalCp,
          mate,
          lastBestMove: result.bestMove,
          evalDepth: result.depth,
        });

        // Cache on the current node for next time we visit.
        const { tree, currentNodeId } = get();
        updateNode(tree, currentNodeId, {
          evalCp,
          mate,
        });
      })
      .catch((err) => {
        if (seq !== analysisSeq) return;
        console.error('[engine] analysis failed', err);
        set({ thinking: false });
      });
  };

  /**
   * Kick off analysis for the current position. When it resolves:
   *   • update evalCp / mate / lastBestMove (eval bar feeds)
   *   • if a humanMove context is provided, run the coaching pipeline
   *     (classify → tag → template), cache the payload on the node,
   *     and stash it on the store for CoachPanel to read
   *   • if the engine should play and the position is still current,
   *     extend the tree with the engine's move and recurse without
   *     a humanMove context.
   */
  const kickAnalysis = (
    fen: string,
    sideToMove: 'w' | 'b',
    seq: number,
    humanMove?: HumanMoveContext
  ): void => {
    if (seq !== analysisSeq) return;

    set({ thinking: true });
    const { skillLevel, searchDepth } = get();

    analyzePosition(fen, { depth: searchDepth, skillLevel })
      .then(async (result) => {
        if (seq !== analysisSeq) return;

        const { evalCp, mate } = normalizeEval(
          result.evalCp,
          result.mate,
          sideToMove
        );
        set({
          thinking: false,
          evalCp,
          mate,
          lastBestMove: result.bestMove,
          evalDepth: result.depth,
        });

        // Cache the engine eval on the current node.
        const { tree: treeNow, currentNodeId: curNowId } = get();
        updateNode(treeNow, curNowId, { evalCp, mate });

        // Coaching pipeline runs only when this analysis completed
        // right after a HUMAN move. Engine moves and navigations are
        // not coached.
        if (humanMove) {
          const classifyResult = classifyMove({
            evalBeforeCp: humanMove.evalBeforeCp,
            evalBeforeMate: humanMove.evalBeforeMate,
            evalAfterCp: evalCp,
            evalAfterMate: mate,
            moverColor: humanMove.moverColor,
          });
          const quality = classifyResult.quality;

          if (quality) {
            const bestMoveSan = humanMove.bestMoveBeforeUci
              ? uciToSan(humanMove.bestMoveBeforeUci, humanMove.fenBefore)
              : '';
            const phase = detectPhase(humanMove.fenBefore);
            const motifs = await tagMove({
              fenBefore: humanMove.fenBefore,
              fenAfter: fen,
              playerMoveUci: humanMove.playerMoveUci,
              bestMoveBeforeUci: humanMove.bestMoveBeforeUci,
              evalBeforeCp: humanMove.evalBeforeCp,
              evalBeforeMate: humanMove.evalBeforeMate,
              evalAfterCp: evalCp,
              evalAfterMate: mate,
              pvAfter: result.pv,
              moverColor: humanMove.moverColor,
              quality,
            });
            const coach = await getCoachExplanation({
              fenBefore: humanMove.fenBefore,
              playerMove: humanMove.playerMoveSan,
              bestMove: bestMoveSan,
              pv: result.pv,
              quality,
              cpLoss: classifyResult.cpLoss,
              motifs,
              phase,
            });

            if (seq !== analysisSeq) return;

            // Cache on the node so re-navigation restores it.
            const { tree: t2 } = get();
            updateNode(t2, humanMove.nodeId, {
              quality,
              motifs,
              coachText: coach.text,
              coachSource: coach.source,
              cpLoss: classifyResult.cpLoss,
            });

            // ---- Phase 5: feed the weakness profile ----
            const profile = useProfileStore.getState();
            profile.incrementMoves();
            if (
              quality === 'inaccuracy' ||
              quality === 'mistake' ||
              quality === 'blunder'
            ) {
              const humanNode = getNode(t2, humanMove.nodeId);
              const event: WeaknessEvent = {
                id: `${t2.id}:${humanMove.nodeId}`,
                gameId: t2.id,
                moveNumber: Math.ceil(humanNode.ply / 2),
                fen: humanMove.fenBefore,
                playerMove: humanMove.playerMoveSan,
                bestMove: bestMoveSan,
                cpLoss: classifyResult.cpLoss,
                quality,
                phase,
                motifs,
                color: humanMove.moverColor === 'w' ? 'white' : 'black',
                timestamp: Date.now(),
              };
              profile.addWeaknessEvent(event);
            }

            // Only reflect on the live store fields if we're still
            // viewing the move in question.
            if (get().currentNodeId === humanMove.nodeId) {
              set({
                lastMoveQuality: quality,
                lastMoveMotifs: motifs,
                lastMoveCoachText: coach.text,
                lastMoveCoachSource: coach.source,
                lastMoveCpLoss: classifyResult.cpLoss,
                lastMoveBestMoveBefore: humanMove.bestMoveBeforeUci,
              });
            }
          }

          // Opportunistic game save after every classified human move.
          const saveState = get();
          maybeFinishMainGame(
            saveState.tree,
            saveState.humanColor,
            saveState.engineEnabled
          );
          persistTree(
            saveState.tree,
            saveState.humanColor,
            saveState.engineEnabled
          );
        }

        // Decide whether Stockfish should now play.
        const state = get();
        if (
          !state.engineEnabled ||
          state.isGameOver ||
          state.turn === state.humanColor ||
          !result.bestMove ||
          result.bestMove === '(none)' ||
          result.bestMove === '0000'
        ) {
          return;
        }

        // Apply engine move to the tree, extending wherever we are.
        const engineUci = result.bestMove;
        const chess = new Chess(state.fen);
        let engineMove;
        try {
          engineMove = chess.move(parseUci(engineUci));
        } catch (err) {
          console.error('[engine] failed to apply bestmove', engineUci, err);
          return;
        }
        if (!engineMove) return;

        const engineSan = engineMove.san;
        const engineFenAfter = chess.fen();
        const engineMoverColor: 'w' | 'b' = state.turn;

        const { tree: t3, currentNodeId: curId } = state;
        const curNode = getNode(t3, curId);

        const existing = findChildBySan(t3, curId, engineSan);
        let targetId: string;
        let newMainHead = t3.mainGameHeadId;
        let newExplorationRootId = state.explorationRootId;

        if (existing) {
          targetId = existing.id;
          const branch = findBranchRoot(t3, targetId);
          newExplorationRootId = branch ? branch.id : null;
        } else {
          const newNode = addChild(t3, curId, {
            move: engineSan,
            uci: `${engineMove.from}${engineMove.to}${engineMove.promotion ?? ''}`,
            fen: engineFenAfter,
            moverColor: engineMoverColor,
            evalCp: null,
            mate: null,
            bestMoveBeforeUci: null,
            quality: null,
            motifs: [],
            coachText: null,
            coachSource: null,
            cpLoss: null,
          });
          targetId = newNode.id;

          // Engine extending the mainline tip keeps things on the
          // mainline. Engine moves inside an exploration branch stay
          // in that branch.
          if (
            state.explorationRootId === null &&
            curId === t3.mainGameHeadId
          ) {
            newMainHead = targetId;
            t3.mainGameHeadId = newMainHead;
          }
        }
        t3.currentNodeId = targetId;

        analysisSeq += 1;
        const nextSeq = analysisSeq;
        const targetNode = getNode(t3, targetId);
        const snap = snapshotFromFen(targetNode.fen);
        set({
          tree: { ...t3 },
          currentNodeId: targetId,
          mainGameHeadId: newMainHead,
          explorationRootId: newExplorationRootId,
          history: pathFromRoot(t3, targetId).slice(1),
          ...snap,
          lastBestMove: null,
          // Keep the human's coach state pinned until the NEXT human move.
        });
        void curNode; // referenced above for readability

        // Phase 5: persist tree + mark game finished if the engine's
        // move just ended the main game.
        maybeFinishMainGame(t3, state.humanColor, state.engineEnabled);
        persistTree(t3, state.humanColor, state.engineEnabled);

        kickAnalysis(targetNode.fen, snap.turn, nextSeq);
      })
      .catch((err) => {
        if (seq !== analysisSeq) return;
        console.error('[engine] analysis failed', err);
        set({ thinking: false });
      });
  };

  return {
    // Tree state defaults
    tree: initialTree,
    currentNodeId: initialTree.rootId,
    mainGameHeadId: initialTree.mainGameHeadId,
    explorationRootId: null,
    forkBlockedReason: null,
    history: [],

    // Board snapshot defaults
    ...snapshotFromFen(getNode(initialTree, initialTree.rootId).fen),

    // Engine state defaults
    thinking: false,
    evalCp: 0,
    mate: null,
    lastBestMove: null,
    evalDepth: 0,

    // Engine settings defaults
    engineEnabled: true,
    humanColor: 'w',
    skillLevel: 10,
    searchDepth: 14,

    // Coach state defaults
    ...EMPTY_COACH_STATE,

    makeMove: (from, to, promotion) => {
      const state = get();
      if (state.isGameOver) return false;
      if (state.engineEnabled && state.turn !== state.humanColor) return false;

      const { tree, currentNodeId, mainGameHeadId, explorationRootId } = state;
      const currentNode = getNode(tree, currentNodeId);

      // Apply the move on a scratch chess instance to validate it and
      // grab the SAN/UCI/resulting FEN.
      const chess = new Chess(currentNode.fen);
      const moverColor = chess.turn() as 'w' | 'b';
      let move;
      try {
        move = chess.move({ from, to, promotion: promotion ?? 'q' });
      } catch {
        return false;
      }
      if (!move) return false;

      const san = move.san;
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      const fenAfter = chess.fen();

      // If this exact SAN is already a child, just navigate there.
      const existing = findChildBySan(tree, currentNodeId, san);
      if (existing) {
        get().goToNode(existing.id);
        return true;
      }

      // Fresh move — would this create a new top-level branch root?
      const wouldCreateNewBranchRoot =
        explorationRootId === null && currentNodeId !== mainGameHeadId;
      if (wouldCreateNewBranchRoot) {
        const count = countExplorationBranches(tree);
        if (count >= MAX_ANON_BRANCHES) {
          const msg = `Anonymous branch limit reached (${MAX_ANON_BRANCHES}). Sign in to unlock unlimited branches.`;
          set({ forkBlockedReason: msg });
          setTimeout(() => {
            if (get().forkBlockedReason === msg) {
              set({ forkBlockedReason: null });
            }
          }, 5000);
          return false;
        }
      }

      const fenBefore = currentNode.fen;
      const evalBeforeCp = state.evalCp;
      const evalBeforeMate = state.mate;
      const bestMoveBeforeUci = state.lastBestMove;

      const newNode = addChild(tree, currentNodeId, {
        move: san,
        uci,
        fen: fenAfter,
        moverColor,
        evalCp: null,
        mate: null,
        bestMoveBeforeUci,
        quality: null,
        motifs: [],
        coachText: null,
        coachSource: null,
        cpLoss: null,
      });

      let newMainHead = mainGameHeadId;
      let newExplorationRootId = explorationRootId;

      if (explorationRootId === null && currentNodeId === mainGameHeadId) {
        // Mainline extension — advance the real game tip.
        newMainHead = newNode.id;
        tree.mainGameHeadId = newMainHead;
      } else if (explorationRootId === null) {
        // Starting a new branch from mainline middle.
        newExplorationRootId = newNode.id;
      }
      // else: extending an existing branch — no pointer changes.

      tree.currentNodeId = newNode.id;

      analysisSeq += 1;
      const seq = analysisSeq;

      const snap = snapshotFromFen(fenAfter);
      set({
        tree: { ...tree },
        currentNodeId: newNode.id,
        mainGameHeadId: newMainHead,
        explorationRootId: newExplorationRootId,
        history: pathFromRoot(tree, newNode.id).slice(1),
        ...snap,
        lastBestMove: null,
        ...EMPTY_COACH_STATE,
      });

      kickAnalysis(fenAfter, snap.turn, seq, {
        nodeId: newNode.id,
        fenBefore,
        playerMoveUci: uci,
        playerMoveSan: san,
        bestMoveBeforeUci,
        evalBeforeCp,
        evalBeforeMate,
        moverColor,
      });
      return true;
    },

    goToNode: (nodeId) => {
      const { tree } = get();
      if (!tree.nodes.has(nodeId)) return;
      tree.currentNodeId = nodeId;
      analysisSeq += 1;
      const seq = analysisSeq;
      set({
        ...navState(tree, nodeId),
        tree: { ...tree },
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
      });
      const snap = snapshotFromFen(getNode(tree, nodeId).fen);
      kickObservation(snap.fen, snap.turn, seq);
    },

    tryThisLine: () => {
      const state = get();
      const {
        tree,
        currentNodeId,
        engineEnabled,
        humanColor,
        lastMoveBestMoveBefore,
      } = state;

      const current = getNode(tree, currentNodeId);

      // If the engine has already responded to the user's move, the
      // currently-focused node is the engine's move — step back one
      // ply so we fork at the user's move instead. Without this, we'd
      // apply the pre-user-move bestMove to the post-user-move FEN
      // (wrong side, wrong pieces) and chess.js would throw.
      let userMoveNode = current;
      if (
        engineEnabled &&
        current.moverColor !== null &&
        current.moverColor !== humanColor &&
        current.parentId
      ) {
        userMoveNode = getNode(tree, current.parentId);
      }

      if (!userMoveNode.parentId) return;

      // Prefer the node's own cached bestMoveBeforeUci (set when the
      // move was first made) over the live coach-state field, which
      // may have been cleared by navigation.
      const bestUci =
        userMoveNode.bestMoveBeforeUci ?? lastMoveBestMoveBefore;
      if (!bestUci) return;

      // Check the anon cap BEFORE doing any work.
      const count = countExplorationBranches(tree);
      if (count >= MAX_ANON_BRANCHES) {
        const msg = `Anonymous branch limit reached (${MAX_ANON_BRANCHES}). Sign in to unlock unlimited branches.`;
        set({ forkBlockedReason: msg });
        setTimeout(() => {
          if (get().forkBlockedReason === msg) {
            set({ forkBlockedReason: null });
          }
        }, 5000);
        return;
      }

      const parent = getNode(tree, userMoveNode.parentId);

      const chess = new Chess(parent.fen);
      const moverColor = chess.turn() as 'w' | 'b';
      let move;
      try {
        move = chess.move(parseUci(bestUci));
      } catch (err) {
        console.error(
          '[tryThisLine] failed to apply bestMove',
          bestUci,
          'at',
          parent.fen,
          err
        );
        return;
      }
      if (!move) return;

      const san = move.san;
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      const fenAfter = chess.fen();

      // If a sibling with this SAN already exists, reuse it.
      let targetNode = findChildBySan(tree, parent.id, san);
      if (!targetNode) {
        targetNode = addChild(tree, parent.id, {
          move: san,
          uci,
          fen: fenAfter,
          moverColor,
          evalCp: null,
          mate: null,
          bestMoveBeforeUci: parent.bestMoveBeforeUci,
          quality: null,
          motifs: [],
          coachText: null,
          coachSource: null,
          cpLoss: null,
        });
      }

      tree.currentNodeId = targetNode.id;
      analysisSeq += 1;
      const seq = analysisSeq;

      const snap = snapshotFromFen(targetNode.fen);
      set({
        tree: { ...tree },
        currentNodeId: targetNode.id,
        mainGameHeadId: tree.mainGameHeadId,
        // This branch is explicitly an exploration root.
        explorationRootId: targetNode.isExploration
          ? targetNode.id
          : findBranchRoot(tree, targetNode.id)?.id ?? targetNode.id,
        forkBlockedReason: null,
        history: pathFromRoot(tree, targetNode.id).slice(1),
        ...snap,
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
        ...EMPTY_COACH_STATE,
      });

      // Observation-only: "best move" coaching would just say "best move".
      // But we still want the engine to respond, so use kickAnalysis
      // (which will auto-play if it's engine's turn).
      kickAnalysis(snap.fen, snap.turn, seq);
    },

    returnToMainGame: () => {
      const { tree } = get();
      tree.currentNodeId = tree.mainGameHeadId;
      analysisSeq += 1;
      const seq = analysisSeq;
      set({
        ...navState(tree, tree.mainGameHeadId),
        tree: { ...tree },
        explorationRootId: null,
        forkBlockedReason: null,
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
      });
      const snap = snapshotFromFen(getNode(tree, tree.mainGameHeadId).fen);
      kickObservation(snap.fen, snap.turn, seq);
    },

    dismissForkError: () => {
      set({ forkBlockedReason: null });
    },

    reset: () => {
      // Persist the outgoing game (whether finished or in progress)
      // before we drop the reference to its tree.
      const prev = get();
      if (prev.history.length > 0) {
        persistTree(prev.tree, prev.humanColor, prev.engineEnabled);
      }

      const fresh = createTree();
      analysisSeq += 1;
      const seq = analysisSeq;
      engineNewGame();
      const snap = snapshotFromFen(getNode(fresh, fresh.rootId).fen);
      set({
        tree: fresh,
        currentNodeId: fresh.rootId,
        mainGameHeadId: fresh.mainGameHeadId,
        explorationRootId: null,
        forkBlockedReason: null,
        history: [],
        ...snap,
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
        ...EMPTY_COACH_STATE,
      });
      // If the human is black, Stockfish needs to open the game.
      if (get().engineEnabled && get().humanColor === 'b') {
        kickAnalysis(snap.fen, snap.turn, seq);
      }
    },

    undo: () => {
      const state = get();
      const { tree, currentNodeId, engineEnabled, humanColor } = state;
      const current = getNode(tree, currentNodeId);
      if (!current.parentId) return; // Already at root — nothing to undo.

      let targetId = current.parentId;
      const parentNode = getNode(tree, targetId);

      // When playing the engine, popping one ply leaves the engine's
      // move on the board. Pop another so it's the human's turn.
      if (
        engineEnabled &&
        parentNode.parentId !== null &&
        snapshotFromFen(parentNode.fen).turn !== humanColor
      ) {
        targetId = parentNode.parentId;
      }

      tree.currentNodeId = targetId;
      analysisSeq += 1;
      const seq = analysisSeq;
      set({
        ...navState(tree, targetId),
        tree: { ...tree },
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
      });
      const snap = snapshotFromFen(getNode(tree, targetId).fen);
      kickObservation(snap.fen, snap.turn, seq);
    },

    setEngineEnabled: (on) => {
      set({ engineEnabled: on });
      const state = get();
      if (on && !state.isGameOver && state.turn !== state.humanColor) {
        analysisSeq += 1;
        const seq = analysisSeq;
        kickAnalysis(state.fen, state.turn, seq);
      }
    },

    setHumanColor: (color) => {
      set({ humanColor: color });
      const state = get();
      if (state.engineEnabled && !state.isGameOver && state.turn !== color) {
        analysisSeq += 1;
        const seq = analysisSeq;
        kickAnalysis(state.fen, state.turn, seq);
      }
    },

    setSkillLevel: (level) => {
      set({ skillLevel: Math.max(0, Math.min(20, Math.round(level))) });
    },
  };
});
