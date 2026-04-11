/**
 * Phase 5 weakness selector.
 *
 * Pure functions on top of a `PlayerProfile` that pick which motifs
 * should currently drive coaching. The selector is decay-aware —
 * a motif with a huge lifetime `count` that the player hasn't tripped
 * in weeks will fall below a fresher motif with only a handful of
 * recent events.
 *
 * DESIGN.md §10 rules:
 *   • Sort motifs by `decayedCount` desc.
 *   • Drop motifs with lifetime `count < MIN_COUNT` (statistical floor).
 *   • Return the top N ids.
 */

import type { PlayerProfile, MotifCounter } from './types';
import type { ProfileSummary } from '../coach/types';

/**
 * Minimum lifetime count a motif needs before it qualifies as a
 * "current weakness". Without this floor a single blunder would
 * dominate ranking until decayed out.
 */
export const MIN_COUNT = 2;

/**
 * A motif whose decayed count has fallen below this threshold is
 * considered "retired" — the dashboard surfaces these as positive
 * reinforcement.
 */
export const RETIRED_THRESHOLD = 0.5;

export interface WeaknessEntry {
  motif: string;
  count: number;
  decayedCount: number;
  avgCpLoss: number;
  lastSeen: number;
}

/**
 * Top N "live" weaknesses sorted by recency-weighted count.
 * Filters out motifs with fewer than `MIN_COUNT` lifetime events.
 */
export function getTopWeaknesses(
  profile: PlayerProfile,
  n: number = 3
): WeaknessEntry[] {
  return Object.entries(profile.motifCounts)
    .filter(([, c]) => c.count >= MIN_COUNT)
    .sort(([, a], [, b]) => b.decayedCount - a.decayedCount)
    .slice(0, n)
    .map(([motif, c]) => toEntry(motif, c));
}

/**
 * Motifs the player used to struggle with but has since improved on —
 * i.e. lifetime `count >= MIN_COUNT` but `decayedCount` has fallen
 * below `RETIRED_THRESHOLD`.
 */
export function getRetiredWeaknesses(
  profile: PlayerProfile
): WeaknessEntry[] {
  return Object.entries(profile.motifCounts)
    .filter(
      ([, c]) => c.count >= MIN_COUNT && c.decayedCount < RETIRED_THRESHOLD
    )
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([motif, c]) => toEntry(motif, c));
}

/**
 * Build the trimmed profile projection injected into CoachRequests.
 * Matches `ProfileSummary` in `src/coach/types.ts`.
 */
export function buildProfileSummary(
  profile: PlayerProfile,
  n: number = 3
): ProfileSummary {
  const top = getTopWeaknesses(profile, n);
  return {
    topMotifs: top.map((w) => w.motif),
    topWeaknesses: top.map((w) => ({
      motif: w.motif,
      count: w.count,
      decayedCount: w.decayedCount,
    })),
    phaseCpLoss: profile.phaseCpLoss,
  };
}

function toEntry(motif: string, c: MotifCounter): WeaknessEntry {
  return {
    motif,
    count: c.count,
    decayedCount: c.decayedCount,
    avgCpLoss: c.count > 0 ? c.cpLossTotal / c.count : 0,
    lastSeen: c.lastSeen,
  };
}
