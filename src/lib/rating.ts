/**
 * ACPL → estimated Elo rating conversion.
 *
 * Uses a piecewise-linear lookup derived from statistical correlations
 * between average centipawn loss and Elo ratings in large databases.
 * The mapping is approximate — it gives a "ballpark" rating that helps
 * casual players understand their strength in familiar terms.
 *
 * Standing labels follow the standard chess title ladder.
 */

/** Lookup table: [acpl, estimatedElo]. Sorted by ascending ACPL. */
const ACPL_TO_ELO: readonly [number, number][] = [
  [0, 2800],
  [5, 2500],
  [10, 2200],
  [15, 2000],
  [25, 1800],
  [35, 1600],
  [50, 1400],
  [70, 1200],
  [100, 1000],
  [150, 800],
  [200, 600],
  [300, 400],
];

/**
 * Convert an ACPL value to an estimated Elo rating.
 * Uses linear interpolation between the lookup table entries.
 */
export function acplToRating(acpl: number): number {
  if (acpl <= ACPL_TO_ELO[0][0]) return ACPL_TO_ELO[0][1];
  const last = ACPL_TO_ELO[ACPL_TO_ELO.length - 1];
  if (acpl >= last[0]) return last[1];

  for (let i = 1; i < ACPL_TO_ELO.length; i++) {
    const [a1, r1] = ACPL_TO_ELO[i - 1];
    const [a2, r2] = ACPL_TO_ELO[i];
    if (acpl <= a2) {
      const t = (acpl - a1) / (a2 - a1);
      return Math.round(r1 + t * (r2 - r1));
    }
  }
  return last[1];
}

/** Human-readable standing based on Elo rating. */
export function ratingStanding(elo: number): string {
  if (elo >= 2500) return 'Grandmaster';
  if (elo >= 2300) return 'International Master';
  if (elo >= 2100) return 'National Master';
  if (elo >= 1900) return 'Candidate Master';
  if (elo >= 1700) return 'Expert';
  if (elo >= 1500) return 'Advanced';
  if (elo >= 1300) return 'Intermediate';
  if (elo >= 1100) return 'Club Player';
  if (elo >= 900) return 'Casual Player';
  if (elo >= 700) return 'Beginner';
  return 'Newcomer';
}

/** Shorthand: convert ACPL to a formatted rating string (e.g. "1450"). */
export function formatRating(acpl: number): string {
  return String(acplToRating(acpl));
}

/** Shorthand: convert ACPL to standing label. */
export function formatStanding(acpl: number): string {
  return ratingStanding(acplToRating(acpl));
}
