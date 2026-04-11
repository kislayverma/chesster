/**
 * Phase 5 game persistence.
 *
 * Saves completed (and in-progress) games to IndexedDB via localforage
 * so they survive reloads and the user can revisit / re-analyze them.
 *
 * Storage layout:
 *
 *   chesster:games:index       → PersistedGameIndexEntry[] (lightweight list)
 *   chesster:game:<id>         → PersistedGame (full tree)
 *
 * The tree's `nodes` Map is flattened to an array before saving and
 * rehydrated back into a Map on load — localforage's default driver
 * does not preserve `Map` across round-trips reliably.
 */

import localforage from 'localforage';
import type { GameTree, MoveNode } from './gameTree';
import type {
  PersistedGame,
  PersistedGameIndexEntry,
  SerializedGameTree,
} from '../profile/types';
import { walkMainline } from './gameTree';

const INDEX_KEY = 'chesster:games:index';
const gameKey = (id: string): string => `chesster:game:${id}`;

/** Flatten a live `GameTree` (Map-backed) into a JSON-safe projection. */
export function serializeTree(tree: GameTree): SerializedGameTree {
  return {
    id: tree.id,
    rootId: tree.rootId,
    currentNodeId: tree.currentNodeId,
    mainGameHeadId: tree.mainGameHeadId,
    result: tree.result,
    startedAt: tree.startedAt,
    nodes: Array.from(tree.nodes.values()),
    stackFrames: tree.stackFrames,
    currentFrameId: tree.currentFrameId,
  };
}

/**
 * Rebuild a live `GameTree` from its serialized projection. If the
 * payload was written by an older build (no `stackFrames`), we
 * synthesize a single mainline frame walking first-children from the
 * root — keeps legacy games loadable without a migration script.
 */
export function deserializeTree(s: SerializedGameTree): GameTree {
  const nodes = new Map<string, MoveNode>();
  for (const n of s.nodes) nodes.set(n.id, n);

  let stackFrames = s.stackFrames;
  let currentFrameId = s.currentFrameId;
  if (!stackFrames || !currentFrameId) {
    // Legacy migration: rebuild frame 0 from the first-child chain.
    const mainIds: string[] = [];
    let cur: MoveNode | undefined = nodes.get(s.rootId);
    while (cur) {
      mainIds.push(cur.id);
      const nextId = cur.childrenIds[0];
      cur = nextId ? nodes.get(nextId) : undefined;
    }
    const frameId = `${s.id}:frame-0`;
    stackFrames = [
      {
        id: frameId,
        index: 0,
        parentFrameId: null,
        forkPointNodeId: null,
        nodeIds: mainIds,
        label: 'Mainline',
      },
    ];
    currentFrameId = frameId;
  }

  return {
    id: s.id,
    rootId: s.rootId,
    currentNodeId: s.currentNodeId,
    mainGameHeadId: s.mainGameHeadId,
    stackFrames,
    currentFrameId,
    result: s.result as GameTree['result'],
    startedAt: s.startedAt,
    nodes,
  };
}

function mainlinePlyCount(tree: GameTree): number {
  let count = 0;
  for (const n of walkMainline(tree)) {
    if (n.parentId !== null) count += 1;
  }
  return count;
}

function toIndexEntry(game: PersistedGame): PersistedGameIndexEntry {
  return {
    id: game.id,
    startedAt: game.startedAt,
    updatedAt: game.updatedAt,
    finishedAt: game.finishedAt,
    result: game.result,
    mainlinePlies: game.mainlinePlies,
    humanColor: game.humanColor,
    engineEnabled: game.engineEnabled,
  };
}

async function readIndex(): Promise<PersistedGameIndexEntry[]> {
  try {
    const idx = await localforage.getItem<PersistedGameIndexEntry[]>(INDEX_KEY);
    return Array.isArray(idx) ? idx : [];
  } catch (err) {
    console.warn('[gameStorage] readIndex failed', err);
    return [];
  }
}

async function writeIndex(idx: PersistedGameIndexEntry[]): Promise<void> {
  try {
    await localforage.setItem(INDEX_KEY, idx);
  } catch (err) {
    console.warn('[gameStorage] writeIndex failed', err);
  }
}

/**
 * Persist (or update) a game by id. Upserts into the index and
 * writes the full tree under its own key. Safe to call opportunistically —
 * e.g. every N moves, on branch creation, or on game end.
 *
 * Returns the `PersistedGame` it built (with a fresh `updatedAt`) so
 * callers that also want to dual-write to Supabase can do so without
 * recomputing metadata. Returns `null` when the local write itself
 * failed — in that case the caller should not mirror to remote either.
 */
export async function saveGame(params: {
  tree: GameTree;
  humanColor: 'w' | 'b';
  engineEnabled: boolean;
  finishedAt?: number | null;
}): Promise<PersistedGame | null> {
  const { tree, humanColor, engineEnabled } = params;
  const now = Date.now();
  const game: PersistedGame = {
    id: tree.id,
    startedAt: tree.startedAt,
    updatedAt: now,
    finishedAt: params.finishedAt ?? (tree.result ? now : null),
    result: tree.result,
    mainlinePlies: mainlinePlyCount(tree),
    engineEnabled,
    humanColor,
    tree: serializeTree(tree),
  };

  try {
    await localforage.setItem(gameKey(game.id), game);
  } catch (err) {
    console.warn('[gameStorage] saveGame failed', err);
    return null;
  }

  const idx = await readIndex();
  const entry = toIndexEntry(game);
  const without = idx.filter((e) => e.id !== game.id);
  without.unshift(entry);
  await writeIndex(without);
  return game;
}

/**
 * Write a fully-formed `PersistedGame` straight to IndexedDB without
 * recomputing metadata. Used by the Phase 9 sync orchestrator when
 * hydrating the local cache from remote rows — we must preserve the
 * server's `updated_at` so subsequent remote saves don't loop.
 */
export async function writePersistedGame(game: PersistedGame): Promise<void> {
  try {
    await localforage.setItem(gameKey(game.id), game);
  } catch (err) {
    console.warn('[gameStorage] writePersistedGame failed', err);
    return;
  }
  const idx = await readIndex();
  const entry = toIndexEntry(game);
  const without = idx.filter((e) => e.id !== game.id);
  without.unshift(entry);
  await writeIndex(without);
}

export async function loadGame(id: string): Promise<PersistedGame | null> {
  try {
    const g = await localforage.getItem<PersistedGame>(gameKey(id));
    return g ?? null;
  } catch (err) {
    console.warn('[gameStorage] loadGame failed', err);
    return null;
  }
}

export async function listGames(): Promise<PersistedGameIndexEntry[]> {
  const idx = await readIndex();
  return [...idx].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteGame(id: string): Promise<void> {
  try {
    await localforage.removeItem(gameKey(id));
  } catch (err) {
    console.warn('[gameStorage] deleteGame failed', err);
  }
  const idx = await readIndex();
  await writeIndex(idx.filter((e) => e.id !== id));
}
