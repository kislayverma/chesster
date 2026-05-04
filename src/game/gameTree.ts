/**
 * Phase 6 game tree — destructive stack-of-forks model.
 *
 * Replaces Phase 4's persistent "first-child = mainline, siblings =
 * branches forever" model with a stack of *frames*. A frame is a
 * contiguous linear chain of moves the player followed. Frame 0 is
 * the real game (the mainline) and is permanent. Pushing a new frame
 * happens any time the player plays a move from a position that isn't
 * the tip of the current frame — i.e. they forked. Popping a frame is
 * destructive: every node belonging to the frames being removed is
 * physically deleted from `tree.nodes` and from their parent's
 * `childrenIds`. This is the core of DESIGN.md §13.
 *
 * The tree itself is still parent/childrenIds-structured so the board
 * + move list can walk it the same way they always did. The frames
 * array sits on top as an ordering overlay: each frame owns a list of
 * node ids, and `stackFrames[0].nodeIds` IS the mainline.
 *
 * Invariants:
 *
 *   • Frame 0 (index 0) always exists, has parentFrameId=null,
 *     forkPointNodeId=null, and its first nodeId is `tree.rootId`.
 *     It can never be destroyed.
 *
 *   • For K > 0, `stackFrames[K]` was pushed onto the stack after
 *     `stackFrames[K-1]` (push order is stack order, not parentage).
 *     `forkPointNodeId` lives in SOME earlier frame — usually but not
 *     necessarily K-1. It is the node at which the player decided to
 *     try an alternative line.
 *
 *   • Mainline extension: when the player plays a move from the tip
 *     of the current frame, the new node is added as a child of the
 *     tip and appended to the current frame's `nodeIds`.
 *
 *   • Fork: when the player plays a move from a non-tip position, a
 *     new frame is pushed with `forkPointNodeId = currentNodeId` and
 *     its first node is the new move. The new node is added as a
 *     (non-first) child of the fork point so `walkMainline` keeps
 *     following the original first-child chain.
 *
 *   • `popToFrameId(tree, frameId)` removes every frame strictly
 *     above `frameId` in the stack, deleting their nodes from the
 *     tree. `frameId` itself is preserved (that's the user-facing
 *     spec: clicking a frame doesn't kill it).
 */

import { v4 as uuidv4 } from 'uuid';
import type { MoveQuality } from './moveClassifier';
import type { MotifId } from '../tagging/motifs';

/** Where a game originated. */
export type GameSource = 'live' | 'chesscom' | 'lichess' | 'pgn_upload';

/** Metadata for games imported from external platforms. */
export interface ImportMetadata {
  source: GameSource;
  /** Platform-specific game identifier (URL for Chess.com, game ID for Lichess). */
  externalId?: string;
  whitePlayer?: string;
  blackPlayer?: string;
  whiteElo?: number;
  blackElo?: number;
  /** e.g. "600", "180+2", "900+10" */
  timeControl?: string;
  /** Epoch ms when the game was originally played. */
  playedAt?: number;
}

export interface MoveNode {
  /** Stable id. Root node gets a sentinel id; children get fresh UUIDs. */
  id: string;
  /** Parent node id. `null` only for the root. */
  parentId: string | null;

  /** SAN of the move that produced this node, e.g. "Nf3". Empty string on root. */
  move: string;
  /** UCI of the move that produced this node, e.g. "g1f3". Empty string on root. */
  uci: string;
  /** FEN of the position AFTER the move. For root, the starting position. */
  fen: string;
  /** Which side just moved to reach this position. `null` on root. */
  moverColor: 'w' | 'b' | null;
  /** 1-indexed ply number (root = 0, first move = 1, etc.). */
  ply: number;

  /** Cached engine eval at this node (white-perspective cp), if analyzed. */
  evalCp: number | null;
  /** Cached engine mate score at this node, if analyzed. */
  mate: number | null;
  /**
   * Engine's top-choice move at this node in UCI (used for "Try this line"
   * on the move that *led here* — i.e. the parent's bestMove lives on the
   * child, since that's where we classify the move).
   */
  bestMoveBeforeUci: string | null;

  /** Move quality (cpLoss bucket) for the move that led here. */
  quality: MoveQuality | null;
  /** Detected motifs for the move that led here. */
  motifs: MotifId[];
  /** Rendered coach text for the move that led here. */
  coachText: string | null;
  coachSource: 'llm' | 'template' | null;
  /** cpLoss for the move that led here (for inspection / debug). */
  cpLoss: number | null;

  /**
   * Child ids. `childrenIds[0]` is the first child (the continuation
   * of whichever frame the parent belongs to). Any entries beyond
   * that are roots of frames pushed on top of this node.
   */
  childrenIds: string[];
}

/**
 * A single level of the exploration stack. Frame 0 is the mainline
 * (the real game) and is permanent; K > 0 are the pushed branches.
 */
export interface StackFrame {
  /** Stable id for this frame. */
  id: string;
  /** 0-based position in the stack (0 = mainline). */
  index: number;
  /** Parent frame id, or null for the mainline. */
  parentFrameId: string | null;
  /**
   * The node in the parent frame at which this fork was spawned, or
   * null for the mainline. After a destructive pop this is where the
   * board lands.
   */
  forkPointNodeId: string | null;
  /**
   * Ordered list of node ids belonging to this frame, from earliest
   * to latest. `nodeIds[0]` is the first move (for frame 0 it's the
   * synthetic root node). `nodeIds[nodeIds.length-1]` is the tip.
   */
  nodeIds: string[];
  /** Human-readable label for the stack panel. */
  label: string;
}

export interface GameTree {
  id: string;
  nodes: Map<string, MoveNode>;
  rootId: string;
  /** The node whose FEN the board is showing right now. */
  currentNodeId: string;
  /**
   * Convenience mirror of `stackFrames[0]` tip. Kept on the tree so
   * MoveList can read it without touching the stack array.
   */
  mainGameHeadId: string;
  /** The entire exploration stack, frame 0 is always the mainline. */
  stackFrames: StackFrame[];
  /**
   * Id of the frame that currently owns `currentNodeId`. Updated on
   * every navigation / move. This is "which row of the stack panel
   * should be highlighted".
   */
  currentFrameId: string;
  /** Final result if the game has ended on the mainline. */
  result: '1-0' | '0-1' | '1/2-1/2' | null;
  /** When this game tree was created (ms since epoch). */
  startedAt: number;
}

/** FEN for the standard chess starting position. */
export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Create an empty tree whose root is the starting position. */
export function createTree(startingFen: string = STARTING_FEN): GameTree {
  const rootId = uuidv4();
  const root: MoveNode = {
    id: rootId,
    parentId: null,
    move: '',
    uci: '',
    fen: startingFen,
    moverColor: null,
    ply: 0,
    evalCp: null,
    mate: null,
    bestMoveBeforeUci: null,
    quality: null,
    motifs: [],
    coachText: null,
    coachSource: null,
    cpLoss: null,
    childrenIds: [],
  };
  const nodes = new Map<string, MoveNode>();
  nodes.set(rootId, root);

  const mainlineFrame: StackFrame = {
    id: uuidv4(),
    index: 0,
    parentFrameId: null,
    forkPointNodeId: null,
    nodeIds: [rootId],
    label: 'Mainline',
  };

  return {
    id: uuidv4(),
    nodes,
    rootId,
    currentNodeId: rootId,
    mainGameHeadId: rootId,
    stackFrames: [mainlineFrame],
    currentFrameId: mainlineFrame.id,
    result: null,
    startedAt: Date.now(),
  };
}

/** Look up a node by id, throwing a clear error if it's missing. */
export function getNode(tree: GameTree, id: string): MoveNode {
  const n = tree.nodes.get(id);
  if (!n) throw new Error(`gameTree: node ${id} not found`);
  return n;
}

/** Look up a frame by id, throwing if missing. */
export function getFrame(tree: GameTree, id: string): StackFrame {
  const f = tree.stackFrames.find((fr) => fr.id === id);
  if (!f) throw new Error(`gameTree: frame ${id} not found`);
  return f;
}

/**
 * Return the first existing child whose SAN matches `san`, if any.
 * Lets us reuse nodes when a user replays the same move they already
 * explored (instead of duplicating the whole subtree).
 */
export function findChildBySan(
  tree: GameTree,
  parentId: string,
  san: string
): MoveNode | null {
  const parent = getNode(tree, parentId);
  for (const cid of parent.childrenIds) {
    const c = tree.nodes.get(cid);
    if (c && c.move === san) return c;
  }
  return null;
}

/**
 * Append a new child to `parentId`. First child is a simple
 * continuation; subsequent children are the roots of branch frames.
 * Mutates `tree` in place and returns the new node.
 */
export function addChild(
  tree: GameTree,
  parentId: string,
  partial: Omit<MoveNode, 'id' | 'parentId' | 'childrenIds' | 'ply'>
): MoveNode {
  const parent = getNode(tree, parentId);
  const id = uuidv4();
  const node: MoveNode = {
    ...partial,
    id,
    parentId,
    ply: parent.ply + 1,
    childrenIds: [],
  };
  tree.nodes.set(id, node);
  parent.childrenIds.push(id);
  return node;
}

/** Shallow-merge new fields onto a node. Mutates in place. */
export function updateNode(
  tree: GameTree,
  id: string,
  patch: Partial<MoveNode>
): void {
  const n = getNode(tree, id);
  Object.assign(n, patch);
}

/**
 * Walk the path from root → `id`, returning every node in order
 * (root first, target last). Used by MoveList to figure out which
 * mainline prefix to highlight, and by the store to reconstruct
 * chess.js state when jumping around the tree.
 */
export function pathFromRoot(tree: GameTree, id: string): MoveNode[] {
  const out: MoveNode[] = [];
  let cur: MoveNode | null = getNode(tree, id);
  while (cur) {
    out.push(cur);
    cur = cur.parentId ? getNode(tree, cur.parentId) : null;
  }
  out.reverse();
  return out;
}

/**
 * Yield nodes along the mainline. In the stack model this is exactly
 * frame 0's `nodeIds`.
 */
export function* walkMainline(tree: GameTree): Generator<MoveNode> {
  const main = tree.stackFrames[0];
  if (!main) return;
  for (const id of main.nodeIds) {
    const n = tree.nodes.get(id);
    if (n) yield n;
  }
}

/** True if `id` is the current tip of `frame`. */
export function isFrameTip(frame: StackFrame, id: string): boolean {
  return frame.nodeIds[frame.nodeIds.length - 1] === id;
}

/**
 * Linear search across every frame's `nodeIds` for the frame that
 * owns `nodeId`. Returns frame 0 as a safe fallback if the node
 * isn't found on any frame (which shouldn't normally happen).
 */
export function findFrameForNode(
  tree: GameTree,
  nodeId: string
): StackFrame {
  for (const frame of tree.stackFrames) {
    if (frame.nodeIds.includes(nodeId)) return frame;
  }
  return tree.stackFrames[0];
}

/** Append `nodeId` to a frame's tip, mutating the tree's frame array. */
export function extendFrame(
  tree: GameTree,
  frameId: string,
  nodeId: string
): void {
  const frame = getFrame(tree, frameId);
  frame.nodeIds = [...frame.nodeIds, nodeId];
  if (frame.index === 0) {
    tree.mainGameHeadId = nodeId;
  }
}

/**
 * Push a new frame onto the stack with its first node already
 * materialized. `firstMoveNodeId` must already be in `tree.nodes`
 * (the caller is responsible for `addChild`-ing it). Returns the
 * new frame.
 */
export function pushFrame(
  tree: GameTree,
  forkPointNodeId: string,
  firstMoveNodeId: string
): StackFrame {
  const parentFrame = findFrameForNode(tree, forkPointNodeId);
  const index = tree.stackFrames.length;
  const frame: StackFrame = {
    id: uuidv4(),
    index,
    parentFrameId: parentFrame.id,
    forkPointNodeId,
    nodeIds: [firstMoveNodeId],
    label: `Branch ${index}`,
  };
  tree.stackFrames = [...tree.stackFrames, frame];
  return frame;
}

/**
 * Destructively remove every frame strictly above `targetFrameId`.
 * Returns:
 *   - the target frame (which is preserved), and
 *   - the node id where the board should land: for K>0 it's the
 *     target frame's fork point (a node in some earlier frame); for
 *     frame 0 it's the current mainline head.
 *
 * Mutates `tree` in place.
 */
export function popToFrameId(
  tree: GameTree,
  targetFrameId: string
): { target: StackFrame; landingNodeId: string } {
  const idx = tree.stackFrames.findIndex((f) => f.id === targetFrameId);
  if (idx < 0) {
    throw new Error(`popToFrameId: frame ${targetFrameId} not found`);
  }
  const target = tree.stackFrames[idx];

  // Walk top-down so the bottom-most dropped frame is destroyed last;
  // in practice order doesn't matter because each frame is fully
  // self-contained and cleanup is idempotent.
  for (let i = tree.stackFrames.length - 1; i > idx; i--) {
    const frame = tree.stackFrames[i];
    for (const nodeId of frame.nodeIds) {
      const node = tree.nodes.get(nodeId);
      if (!node) continue;
      if (node.parentId) {
        const parent = tree.nodes.get(node.parentId);
        if (parent) {
          parent.childrenIds = parent.childrenIds.filter((c) => c !== nodeId);
        }
      }
      tree.nodes.delete(nodeId);
    }
  }

  tree.stackFrames = tree.stackFrames.slice(0, idx + 1);

  // Land at the tip of the target frame. For frame 0 this is the
  // mainline head; for branch frames this is the last move the player
  // made inside that branch (so clicking "Branch 1" drops you back at
  // Branch 1's last position, not at its fork point in the parent).
  const landingNodeId = target.nodeIds[target.nodeIds.length - 1];

  return { target, landingNodeId };
}

/** Number of exploration frames on top of the mainline. */
export function stackDepth(tree: GameTree): number {
  return Math.max(0, tree.stackFrames.length - 1);
}
