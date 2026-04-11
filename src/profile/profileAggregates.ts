/**
 * Phase 5 profile aggregation.
 *
 * The `weaknessEvents` array on `PlayerProfile` is the source of truth.
 * Everything else (motifCounts, phaseCpLoss, openingWeaknesses) is
 * *derived* — so the aggregate fields can be recomputed at any time,
 * and a vocab-version bump (DESIGN.md §7) never corrupts history.
 *
 * Recency decay
 * -------------
 *   decayedCount = Σ exp(-(now - event.timestamp) / HALFLIFE_MS)
 *
 * With `HALFLIFE_MS ≈ 14 days`, an event 14 days old contributes
 * ~0.5, one a month old contributes ~0.22, and one a year old
 * contributes ~1e-11. This makes the profile reflect *current*
 * weaknesses instead of lifetime ones.
 */

import type {
  PlayerProfile,
  WeaknessEvent,
  MotifCounter,
  OpeningStat,
} from './types';
import type { GamePhase } from '../tagging/phaseDetector';

/** 14 days in milliseconds — decay half-life for motifCounts.decayedCount. */
export const HALFLIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Rolling window size used for `phaseCpLoss`. We only average the last
 * K events per phase so a very long history doesn't mask recent
 * improvement.
 */
const PHASE_WINDOW = 50;

export function createEmptyProfile(now: number = Date.now()): PlayerProfile {
  return {
    totalGames: 0,
    totalMoves: 0,
    weaknessEvents: [],
    motifCounts: {},
    phaseCpLoss: { opening: 0, middlegame: 0, endgame: 0 },
    openingWeaknesses: {},
    acplHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Rebuild all derived aggregates from `profile.weaknessEvents`.
 * Non-mutating — returns a new profile object; `totalGames`,
 * `totalMoves`, `acplHistory`, `createdAt` are preserved.
 */
export function recomputeAggregates(
  profile: PlayerProfile,
  now: number = Date.now()
): PlayerProfile {
  const motifCounts: Record<string, MotifCounter> = {};
  const phaseBuckets: Record<GamePhase, number[]> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };
  const openingAcc: Record<
    string,
    { games: Set<string>; cpLossSum: number; events: number }
  > = {};

  for (const event of profile.weaknessEvents) {
    // --- motifCounts -----------------------------------------------------
    for (const motif of event.motifs) {
      const existing = motifCounts[motif] ?? {
        count: 0,
        decayedCount: 0,
        cpLossTotal: 0,
        lastSeen: 0,
      };
      const age = Math.max(0, now - event.timestamp);
      existing.count += 1;
      existing.decayedCount += Math.exp(-age / HALFLIFE_MS);
      existing.cpLossTotal += event.cpLoss;
      if (event.timestamp > existing.lastSeen) {
        existing.lastSeen = event.timestamp;
      }
      motifCounts[motif] = existing;
    }

    // --- phaseCpLoss (rolling window, last K per phase) ------------------
    phaseBuckets[event.phase].push(event.cpLoss);

    // --- openingWeaknesses ----------------------------------------------
    if (event.eco) {
      const acc = openingAcc[event.eco] ?? {
        games: new Set<string>(),
        cpLossSum: 0,
        events: 0,
      };
      acc.games.add(event.gameId);
      acc.cpLossSum += event.cpLoss;
      acc.events += 1;
      openingAcc[event.eco] = acc;
    }
  }

  const phaseCpLoss = {
    opening: averageLast(phaseBuckets.opening, PHASE_WINDOW),
    middlegame: averageLast(phaseBuckets.middlegame, PHASE_WINDOW),
    endgame: averageLast(phaseBuckets.endgame, PHASE_WINDOW),
  };

  const openingWeaknesses: Record<string, OpeningStat> = {};
  for (const [eco, acc] of Object.entries(openingAcc)) {
    openingWeaknesses[eco] = {
      games: acc.games.size,
      avgCpLoss: acc.events > 0 ? acc.cpLossSum / acc.events : 0,
    };
  }

  return {
    ...profile,
    motifCounts,
    phaseCpLoss,
    openingWeaknesses,
    updatedAt: now,
  };
}

/**
 * Non-mutating: append a new WeaknessEvent and return a profile with
 * refreshed aggregates. Caller is responsible for the totalMoves
 * counter (all moves count, not just mistakes).
 */
export function appendWeaknessEvent(
  profile: PlayerProfile,
  event: WeaknessEvent,
  now: number = Date.now()
): PlayerProfile {
  const next: PlayerProfile = {
    ...profile,
    weaknessEvents: [...profile.weaknessEvents, event],
    updatedAt: now,
  };
  return recomputeAggregates(next, now);
}

/**
 * Record a finished game: bumps totalGames, appends an acplHistory
 * entry. The caller passes the game's average centipawn loss across
 * the player's own moves (0 if none were classified).
 */
export function recordGameFinished(
  profile: PlayerProfile,
  acpl: number,
  now: number = Date.now()
): PlayerProfile {
  return {
    ...profile,
    totalGames: profile.totalGames + 1,
    acplHistory: [...profile.acplHistory, { timestamp: now, acpl }],
    updatedAt: now,
  };
}

/**
 * Bump the totalMoves counter. Called once per classified player move
 * (best, excellent, good, inaccuracy, mistake, blunder). Book moves
 * are excluded — those are memorized, not played.
 */
export function incrementMoveCount(
  profile: PlayerProfile,
  now: number = Date.now()
): PlayerProfile {
  return {
    ...profile,
    totalMoves: profile.totalMoves + 1,
    updatedAt: now,
  };
}

function averageLast(values: number[], windowSize: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(Math.max(0, values.length - windowSize));
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}
