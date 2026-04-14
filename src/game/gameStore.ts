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
 *   • Actions:
 *       - goToNode(id)        — navigate without modifying the tree
 *       - tryThisLine()       — fork and replay with engine's bestMove
 *       - popToFrame(frameId) — destructively drop all frames above
 *                               the target frame and land the board
 *                               at the target frame's tip (last move
 *                               inside that frame)
 *
 *   • Anonymous users are capped at MAX_ANON_BRANCHES exploration
 *     frames above the mainline (DESIGN.md §12b). Attempts to push
 *     a new frame past the cap are silently rejected.
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
import { isBookMove } from '../tagging/ecoLookup';
import type { MotifId } from '../tagging/motifs';
import {
  createTree,
  getNode,
  addChild,
  findChildBySan,
  updateNode,
  pathFromRoot,
  walkMainline,
  findFrameForNode,
  isFrameTip,
  pushFrame,
  extendFrame,
  popToFrameId,
  stackDepth,
  type GameTree,
  type MoveNode,
  type StackFrame,
} from './gameTree';
import { getBranchCap } from '../lib/branchLimit';
import { useProfileStore } from '../profile/profileStore';
import { usePracticeStore } from '../srs/practiceStore';
import type { WeaknessEvent } from '../profile/types';
import { saveGame } from './gameStorage';
import { pushGameRemote } from '../sync/syncOrchestrator';

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

/**
 * Fire-and-forget tree save. Local IndexedDB write is the source of
 * truth; the remote Supabase upsert is best-effort and only runs when
 * there is an authenticated session (the orchestrator no-ops for
 * anonymous users). Errors are swallowed inside both paths.
 */
function persistTree(
  tree: GameTree,
  humanColor: 'w' | 'b',
  engineEnabled: boolean,
  finishedAt: number | null = null
): void {
  void saveGame({ tree, humanColor, engineEnabled, finishedAt }).then((g) => {
    if (g) pushGameRemote(g);
  });
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
  /** Source square of the last move (for board highlight). */
  lastMoveFrom: string | null;
  /** Target square of the last move (for board highlight). */
  lastMoveTo: string | null;
}

export interface TreeState {
  tree: GameTree;
  currentNodeId: string;
  mainGameHeadId: string;
  /** The full exploration stack — frame 0 is the mainline. */
  stackFrames: StackFrame[];
  /** Id of the frame that currently owns `currentNodeId`. */
  currentFrameId: string;
  /** Path from root to currentNodeId, excluding root. */
  history: MoveNode[];
}

interface GameStore
  extends GameSnapshot,
    EngineState,
    EngineSettings,
    CoachState,
    TreeState {
  /**
   * True when the user attempted to branch but was blocked by the
   * anonymous branch cap. Auto-clears after a few seconds.
   */
  branchCapReached: boolean;

  /** Attempt a move from the current position. Returns true if applied. */
  makeMove: (from: string, to: string, promotion?: string) => boolean;

  /** Navigate the board to any node in the tree. */
  goToNode: (nodeId: string) => void;

  /**
   * Fork at the parent of the current node and play the engine's
   * bestMove instead. No-op if we don't have a cached bestMove or if
   * the anon stack-depth cap has been reached.
   */
  tryThisLine: () => void;

  /**
   * Destructively pop the exploration stack down to `frameId`. All
   * frames strictly above the target are deleted from the tree, and
   * the board lands at the tip of the target frame (the last move
   * inside it, or the mainline head for frame 0). Frame 0 can never
   * be destroyed.
   */
  popToFrame: (frameId: string) => void;

  /** Start a fresh game (discards the current tree). */
  reset: () => void;

  /**
   * Undo the most recent move — move currentNode to parent, or to
   * grandparent when playing against the engine. Does NOT mutate the
   * tree; other branches are still reachable via MoveList.
   */
  undo: () => void;

  /** Navigate one ply backwards (towards root). Does NOT trigger engine play. */
  goBack: () => void;
  /** Navigate one ply forwards (towards the tip of the current line). */
  goForward: () => void;

  /** Resign the current game. The human player loses. */
  resign: () => void;

  /**
   * Load a previously persisted game tree into the store so the
   * player can continue playing it. The board lands on the last
   * mainline position.
   */
  resumeGame: (tree: GameTree, humanColor: 'w' | 'b', engineEnabled: boolean) => void;

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
  lastMoveFrom: null,
  lastMoveTo: null,
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
  const frame = findFrameForNode(tree, nodeId);
  tree.currentFrameId = frame.id;
  return {
    tree,
    currentNodeId: nodeId,
    mainGameHeadId: tree.mainGameHeadId,
    stackFrames: tree.stackFrames,
    currentFrameId: frame.id,
    history: pathFromRoot(tree, nodeId).slice(1),
    ...snapshotFromFen(node.fen),
    lastMoveQuality: node.quality,
    lastMoveMotifs: node.motifs,
    lastMoveCoachText: node.coachText,
    lastMoveCoachSource: node.coachSource,
    lastMoveCpLoss: node.cpLoss,
    lastMoveBestMoveBefore: node.bestMoveBeforeUci,
    lastMoveFrom: node.uci ? node.uci.slice(0, 2) : null,
    lastMoveTo: node.uci ? node.uci.slice(2, 4) : null,
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

  /** Flash `branchCapReached` for 4 seconds then auto-clear. */
  let branchCapTimer: ReturnType<typeof setTimeout> | null = null;
  function signalBranchCap() {
    set({ branchCapReached: true });
    if (branchCapTimer) clearTimeout(branchCapTimer);
    branchCapTimer = setTimeout(() => {
      branchCapTimer = null;
      set({ branchCapReached: false });
    }, 4000);
  }

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
          // Phase 12: check if this move falls in a known opening line.
          // If so, skip the full classification pipeline and label it
          // 'book'. The SAN history is derived from the path to the
          // human move's node.
          const { tree: treeForBook } = get();
          const pathToNode = pathFromRoot(treeForBook, humanMove.nodeId);
          const sanMoves = pathToNode
            .filter((n) => n.parentId !== null && n.move)
            .map((n) => n.move);
          const ply = sanMoves.length;

          if (isBookMove(sanMoves, ply)) {
            // Tag as book — no cpLoss, no motifs, no coach text.
            updateNode(treeForBook, humanMove.nodeId, {
              quality: 'book',
              motifs: [],
              coachText: null,
              coachSource: null,
              cpLoss: 0,
            });
            if (get().currentNodeId === humanMove.nodeId) {
              set({
                lastMoveQuality: 'book',
                lastMoveMotifs: [],
                lastMoveCoachText: null,
                lastMoveCoachSource: null,
                lastMoveCpLoss: 0,
              });
            }
          } else {
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

                // Phase 6: auto-generate an SRS practice card for this
                // mistake. `addCard` deduplicates on `event.id`.
                usePracticeStore.getState().addCard(event);
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
          } // end else (non-book)

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

        // Brief pause so the player can see their own move before the
        // engine replies instantly. 400ms feels natural.
        await new Promise((r) => setTimeout(r, 400));
        if (seq !== analysisSeq) return; // stale after pause

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

        const { tree: t3, currentNodeId: curId, currentFrameId } = state;
        const curFrame =
          t3.stackFrames.find((f) => f.id === currentFrameId) ??
          t3.stackFrames[0];

        const existing = findChildBySan(t3, curId, engineSan);
        let targetId: string;

        if (existing) {
          targetId = existing.id;
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

          if (isFrameTip(curFrame, curId)) {
            // Normal case: engine extends the current frame.
            extendFrame(t3, curFrame.id, targetId);
          } else {
            // Engine played from a non-tip position (unusual — would
            // only happen after navigation into a mid-frame position
            // followed by auto-play). Push a new frame, subject to
            // the stack cap.
            if (stackDepth(t3) >= getBranchCap()) {
              signalBranchCap();
              return;
            }
            pushFrame(t3, curId, targetId);
          }
        }
        t3.currentNodeId = targetId;
        const targetFrame = findFrameForNode(t3, targetId);
        t3.currentFrameId = targetFrame.id;

        analysisSeq += 1;
        const nextSeq = analysisSeq;
        const targetNode = getNode(t3, targetId);
        const snap = snapshotFromFen(targetNode.fen);
        set({
          tree: { ...t3 },
          currentNodeId: targetId,
          mainGameHeadId: t3.mainGameHeadId,
          stackFrames: t3.stackFrames,
          currentFrameId: targetFrame.id,
          history: pathFromRoot(t3, targetId).slice(1),
          ...snap,
          lastBestMove: null,
          lastMoveFrom: engineMove.from,
          lastMoveTo: engineMove.to,
          // Keep the human's coach state pinned until the NEXT human move.
        });

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
    stackFrames: initialTree.stackFrames,
    currentFrameId: initialTree.currentFrameId,
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

    // Branch cap error
    branchCapReached: false,

    makeMove: (from, to, promotion) => {
      const state = get();
      if (state.isGameOver) return false;
      // No moves allowed once the game has a result (checkmate, resign, draw).
      if (state.tree.result !== null) return false;
      if (state.engineEnabled && state.turn !== state.humanColor) return false;

      const { tree, currentNodeId, currentFrameId } = state;
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

      // Fresh move — figure out whether it extends the current frame
      // (playing at the frame's tip) or pushes a new frame (playing
      // from a mid-frame position). Pushing is subject to the cap.
      const curFrame =
        tree.stackFrames.find((f) => f.id === currentFrameId) ??
        tree.stackFrames[0];
      const willPushFrame = !isFrameTip(curFrame, currentNodeId);

      if (willPushFrame && stackDepth(tree) >= getBranchCap()) {
        signalBranchCap();
        return false;
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

      if (willPushFrame) {
        pushFrame(tree, currentNodeId, newNode.id);
      } else {
        extendFrame(tree, curFrame.id, newNode.id);
      }

      tree.currentNodeId = newNode.id;
      const newFrame = findFrameForNode(tree, newNode.id);
      tree.currentFrameId = newFrame.id;

      analysisSeq += 1;
      const seq = analysisSeq;

      const snap = snapshotFromFen(fenAfter);
      set({
        tree: { ...tree },
        currentNodeId: newNode.id,
        mainGameHeadId: tree.mainGameHeadId,
        stackFrames: tree.stackFrames,
        currentFrameId: newFrame.id,
        history: pathFromRoot(tree, newNode.id).slice(1),
        ...snap,
        lastBestMove: null,
        ...EMPTY_COACH_STATE,
        lastMoveFrom: from,
        lastMoveTo: to,
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

      // "Try this line" always spawns a new frame — even if the user
      // made the move at the tip of the current frame, we're forking
      // off the *parent* position (the one BEFORE the user's move).
      if (stackDepth(tree) >= getBranchCap()) {
        signalBranchCap();
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

      // If a sibling with this SAN already exists, reuse it; otherwise
      // add a new child of the parent and push a new frame.
      let targetNode = findChildBySan(tree, parent.id, san);
      let targetFrame: StackFrame;
      if (targetNode) {
        targetFrame = findFrameForNode(tree, targetNode.id);
      } else {
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
        targetFrame = pushFrame(tree, parent.id, targetNode.id);
      }

      tree.currentNodeId = targetNode.id;
      tree.currentFrameId = targetFrame.id;
      analysisSeq += 1;
      const seq = analysisSeq;

      const snap = snapshotFromFen(targetNode.fen);
      set({
        tree: { ...tree },
        currentNodeId: targetNode.id,
        mainGameHeadId: tree.mainGameHeadId,
        stackFrames: tree.stackFrames,
        currentFrameId: targetFrame.id,
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

    popToFrame: (frameId) => {
      const { tree } = get();
      const frameExists = tree.stackFrames.some((f) => f.id === frameId);
      if (!frameExists) return;

      const { landingNodeId } = popToFrameId(tree, frameId);
      tree.currentNodeId = landingNodeId;
      const newFrame = findFrameForNode(tree, landingNodeId);
      tree.currentFrameId = newFrame.id;

      analysisSeq += 1;
      const seq = analysisSeq;
      set({
        ...navState(tree, landingNodeId),
        tree: { ...tree },
        stackFrames: tree.stackFrames,
        currentFrameId: newFrame.id,
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
      });
      const snap = snapshotFromFen(getNode(tree, landingNodeId).fen);
      kickObservation(snap.fen, snap.turn, seq);
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
        stackFrames: fresh.stackFrames,
        currentFrameId: fresh.currentFrameId,
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

    goBack: () => {
      const { tree, currentNodeId } = get();
      const current = getNode(tree, currentNodeId);
      if (!current.parentId) return; // at root
      const targetId = current.parentId;
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

    goForward: () => {
      const { tree, currentNodeId } = get();
      const current = getNode(tree, currentNodeId);
      if (current.childrenIds.length === 0) return; // at tip
      // Follow the first child (mainline continuation).
      const targetId = current.childrenIds[0];
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

    resign: () => {
      const state = get();
      if (state.isGameOver) return;
      if (state.history.length === 0) return; // nothing to resign

      const { tree, humanColor, engineEnabled } = state;

      // Mark as finished with the human losing.
      const result: GameTree['result'] =
        humanColor === 'w' ? '0-1' : '1-0';
      tree.result = result;
      finishedGameIds.add(tree.id);

      const acpl = computeMainlineAcpl(tree, humanColor);
      useProfileStore.getState().finishGame(acpl);

      analysisSeq += 1;
      set({
        isGameOver: true,
        result,
      });

      persistTree(tree, humanColor, engineEnabled, Date.now());
    },

    resumeGame: (loadedTree, humanColor, engineEnabled) => {
      // Persist the outgoing game first (same as reset).
      const prev = get();
      if (prev.history.length > 0) {
        persistTree(prev.tree, prev.humanColor, prev.engineEnabled);
      }

      analysisSeq += 1;
      const seq = analysisSeq;
      engineNewGame();

      // Navigate to the mainline head so the player picks up where
      // they left off.
      const headId = loadedTree.mainGameHeadId;
      loadedTree.currentNodeId = headId;
      const frame = findFrameForNode(loadedTree, headId);
      loadedTree.currentFrameId = frame.id;

      const headNode = getNode(loadedTree, headId);
      const snap = snapshotFromFen(headNode.fen);

      set({
        tree: { ...loadedTree },
        currentNodeId: headId,
        mainGameHeadId: loadedTree.mainGameHeadId,
        stackFrames: loadedTree.stackFrames,
        currentFrameId: frame.id,
        history: pathFromRoot(loadedTree, headId).slice(1),
        ...snap,
        humanColor,
        engineEnabled,
        thinking: false,
        lastBestMove: null,
        evalCp: 0,
        mate: null,
        evalDepth: 0,
        ...EMPTY_COACH_STATE,
      });

      // If it's the engine's turn, kick analysis so it plays.
      if (engineEnabled && !snap.isGameOver && snap.turn !== humanColor) {
        kickAnalysis(snap.fen, snap.turn, seq);
      }
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
