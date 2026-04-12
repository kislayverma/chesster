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

/* ─── Journey level definitions (DESIGN.md §17.3) ─────────────────── */

export interface LevelDef {
  key: string;
  name: string;
  /** Minimum Elo to be at this level. */
  floor: number;
  /** Elo ceiling (exclusive) — `Infinity` for the top level. */
  ceiling: number;
  /** Suggested Stockfish skill-level range. */
  skillRange: [number, number];
  description: string;
}

export const ALL_LEVELS: readonly LevelDef[] = [
  { key: 'newcomer',        name: 'Newcomer',         floor: 0,    ceiling: 900,      skillRange: [1, 4],   description: 'Learning the basics — avoid giving away pieces' },
  { key: 'learner',         name: 'Learner',          floor: 900,  ceiling: 1200,     skillRange: [5, 8],   description: 'Building fundamentals — spot simple tactics' },
  { key: 'clubPlayer',      name: 'Club Player',      floor: 1200, ceiling: 1500,     skillRange: [9, 11],  description: 'Solid and improving — develop strategic awareness' },
  { key: 'competitor',      name: 'Competitor',       floor: 1500, ceiling: 1800,     skillRange: [12, 15], description: 'Strategically aware — deeper tactics and planning' },
  { key: 'advancedThinker', name: 'Advanced Thinker', floor: 1800, ceiling: 2200,     skillRange: [16, 18], description: 'Deep understanding — precision and endgame mastery' },
  { key: 'expert',          name: 'Expert',           floor: 2200, ceiling: Infinity,  skillRange: [19, 20], description: 'Elite precision — complex strategy and calculation' },
] as const;

/** Get the full level definition by key. */
export function getLevelDef(key: string): LevelDef {
  return ALL_LEVELS.find((l) => l.key === key) ?? ALL_LEVELS[0];
}

/** Get the next level definition, or `null` if already at the top. */
export function nextLevel(key: string): LevelDef | null {
  const idx = ALL_LEVELS.findIndex((l) => l.key === key);
  if (idx < 0 || idx >= ALL_LEVELS.length - 1) return null;
  return ALL_LEVELS[idx + 1];
}

/** Determine which level a given Elo rating falls into. */
export function levelForRating(elo: number): LevelDef {
  for (let i = ALL_LEVELS.length - 1; i >= 0; i--) {
    if (elo >= ALL_LEVELS[i].floor) return ALL_LEVELS[i];
  }
  return ALL_LEVELS[0];
}
