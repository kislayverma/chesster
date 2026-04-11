/**
 * Phase 4 game tree.
 *
 * Replaces the flat chess.js history with a proper tree so the user
 * can branch off at any ply (via "Try this line"), explore the
 * variation, and jump back to the main game without losing progress.
 *
 * Shape:
 *
 *   • `MoveNode` — one half-move. Holds the SAN + UCI of the move,
 *     the resulting FEN, cached eval/coach payload, and the ids of
 *     its children (first child = mainline continuation, siblings =
 *     exploration branches).
 *
 *   • `GameTree` — id-indexed map of nodes plus navigation pointers:
 *       - rootId              → starting position (empty move)
 *       - currentNodeId       → what the board is showing right now
 *       - mainGameHeadId      → tip of the "real game" (mainline only)
 *       - explorationRootId   → if set, the user is inside a branch
 *                               rooted at this node; "Return to main
 *                               game" sends currentNodeId back to
 *                               mainGameHeadId and clears this.
 *
 * The mainline is defined as the chain you get by always following
 * `childrenIds[0]` starting from root. When the user plays a move
 * from the current mainline head, it's pushed as the new first child
 * and the mainline extends. When the user plays a move from somewhere
 * that isn't the mainline head (e.g. after clicking "Try this line"),
 * the new move becomes a sibling on a branch and `isExploration` is
 * set to true on the branch root.
 *
 * Jumping to any node (e.g. click a move in the MoveList) just sets
 * currentNodeId — it does not truncate or rewrite anything. That's
 * the whole point of the tree: nothing is ever lost.
 */

import { v4 as uuidv4 } from 'uuid';
import type { MoveQuality } from './moveClassifier';
import type { MotifId } from '../tagging/motifs';

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
   * Child ids. `childrenIds[0]` is the mainline continuation; any
   * additional entries are exploration branches / alternative moves.
   */
  childrenIds: string[];

  /**
   * True when this node is the *root* of an exploration branch —
   * i.e. it was inserted by "Try this line" or by playing a move off
   * the main game. Nodes deeper in the branch inherit their branch
   * status via the ancestor chain, not via this flag.
   */
  isExploration: boolean;
}

export interface GameTree {
  id: string;
  nodes: Map<string, MoveNode>;
  rootId: string;
  /** The node whose FEN the board is showing right now. */
  currentNodeId: string;
  /**
   * Tip of the "real game" (always on the mainline). Engine play and
   * normal moves from the mainline head extend this.
   */
  mainGameHeadId: string;
  /**
   * If the user is currently inside an exploration branch, this is
   * the id of the branch's root. `null` when the user is on the
   * mainline.
   */
  explorationRootId: string | null;
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
    isExploration: false,
  };
  const nodes = new Map<string, MoveNode>();
  nodes.set(rootId, root);
  return {
    id: uuidv4(),
    nodes,
    rootId,
    currentNodeId: rootId,
    mainGameHeadId: rootId,
    explorationRootId: null,
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
 * Append a new child to `parentId`. The caller is responsible for
 * deciding whether the child is a mainline continuation (first child)
 * or an exploration sibling. `isExploration` is stamped on the new
 * node if-and-only-if the parent already has a child — i.e. the new
 * node is a second+ child. Mutates `tree` in place and returns the
 * new node.
 */
export function addChild(
  tree: GameTree,
  parentId: string,
  partial: Omit<MoveNode, 'id' | 'parentId' | 'childrenIds' | 'isExploration' | 'ply'>
): MoveNode {
  const parent = getNode(tree, parentId);
  const id = uuidv4();
  const isExploration = parent.childrenIds.length > 0;
  const node: MoveNode = {
    ...partial,
    id,
    parentId,
    ply: parent.ply + 1,
    childrenIds: [],
    isExploration,
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
 * Yield nodes along the mainline (root, then root.childrenIds[0],
 * then that node's first child, etc.) until the chain ends.
 */
export function* walkMainline(tree: GameTree): Generator<MoveNode> {
  let cur: MoveNode | undefined = tree.nodes.get(tree.rootId);
  while (cur) {
    yield cur;
    const nextId = cur.childrenIds[0];
    cur = nextId ? tree.nodes.get(nextId) : undefined;
  }
}

/** True if `id` is reachable from root by always taking the first child. */
export function isMainlineNode(tree: GameTree, id: string): boolean {
  for (const n of walkMainline(tree)) {
    if (n.id === id) return true;
  }
  return false;
}

/**
 * Return the branch root (the nearest ancestor with `isExploration=true`)
 * for `id`, or null if `id` is on the mainline.
 */
export function findBranchRoot(tree: GameTree, id: string): MoveNode | null {
  let cur: MoveNode | null = getNode(tree, id);
  while (cur) {
    if (cur.isExploration) return cur;
    cur = cur.parentId ? getNode(tree, cur.parentId) : null;
  }
  return null;
}
