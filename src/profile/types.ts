/**
 * Phase 5 player-profile types.
 *
 * Matches DESIGN.md §4.2 verbatim. The `PlayerProfile` shape is
 * designed to be trivially serializable so localforage (IndexedDB)
 * can round-trip it without custom coders.
 *
 * `ProfileSummary` lives in `src/coach/types.ts` so that the coach
 * layer could compile before Phase 5 existed; we re-export it here
 * for convenience.
 */

import type { MoveQuality } from '../game/moveClassifier';
import type { GamePhase } from '../tagging/phaseDetector';
import type { MotifId } from '../tagging/motifs';
import type { MoveNode } from '../game/gameTree';

export type { ProfileSummary } from '../coach/types';

/**
 * A single misplay captured for learning. Only created when the move
 * is classified as `inaccuracy`, `mistake`, or `blunder` (DESIGN.md §8).
 */
export interface WeaknessEvent {
  id: string;
  gameId: string;
  /** 1-based full-move number at the time of the mistake. */
  moveNumber: number;
  /** FEN of the position BEFORE the mistake. */
  fen: string;
  /** SAN of the move the player actually played. */
  playerMove: string;
  /** SAN of the engine's top move in the pre-move position. */
  bestMove: string;
  cpLoss: number;
  quality: MoveQuality; // always inaccuracy | mistake | blunder
  phase: GamePhase;
  motifs: MotifId[];
  /** Opening code if an ECO lookup is available. */
  eco?: string;
  color: 'white' | 'black';
  /** `Date.now()` at capture time. */
  timestamp: number;
}

/**
 * Aggregate counter kept per motif. `count` is the raw lifetime tally,
 * `decayedCount` is the exponentially-decayed version used to pick
 * "current" weaknesses for coaching.
 */
export interface MotifCounter {
  count: number;
  decayedCount: number;
  cpLossTotal: number;
  lastSeen: number;
}

export interface AcplHistoryEntry {
  timestamp: number;
  acpl: number;
}

export interface OpeningStat {
  games: number;
  avgCpLoss: number;
}

/**
 * Persistent, per-user (currently anonymous / device-local) profile.
 * The event log is the source of truth — aggregates are derived and
 * can be recomputed from `weaknessEvents` at any time (see
 * `profileAggregates.ts`).
 */
export interface PlayerProfile {
  totalGames: number;
  totalMoves: number;
  /** Append-only log; aggregates are derived from this. */
  weaknessEvents: WeaknessEvent[];
  motifCounts: Record<string, MotifCounter>;
  phaseCpLoss: { opening: number; middlegame: number; endgame: number };
  openingWeaknesses: Record<string, OpeningStat>;
  acplHistory: AcplHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

/**
 * On-disk record for a completed / in-progress game. The full tree is
 * kept so branches survive reloads. Captured lazily on finish +
 * opportunistically on fork (see `gameStorage.ts`).
 */
export interface PersistedGame {
  id: string;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** Final result string (e.g. "1-0", "½-½") if the game has ended. */
  result: string | null;
  /** Total number of mainline plies (for index display). */
  mainlinePlies: number;
  /** Whether the user played with Stockfish on. */
  engineEnabled: boolean;
  humanColor: 'w' | 'b';
  /** Full serialized tree. */
  tree: SerializedGameTree;
}

/**
 * A localforage-safe projection of the live `GameTree`. The runtime
 * tree uses a `Map`, which does not survive JSON round-trips cleanly
 * through localforage's default store, so we flatten nodes to an
 * array before persisting.
 */
export interface SerializedGameTree {
  id: string;
  rootId: string;
  currentNodeId: string;
  mainGameHeadId: string;
  explorationRootId: string | null;
  result: string | null;
  startedAt: number;
  nodes: MoveNode[];
}

/**
 * Index entry for the games list page. Kept separately so the library
 * page can load cheaply without deserializing every tree.
 */
export interface PersistedGameIndexEntry {
  id: string;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  result: string | null;
  mainlinePlies: number;
  humanColor: 'w' | 'b';
  engineEnabled: boolean;
}
