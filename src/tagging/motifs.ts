/**
 * Phase 3 motif vocabulary.
 *
 * Every motif string the rest of the codebase references must live in
 * `MOTIF_IDS` below. Changing or removing an entry here is a vocabulary
 * change and MUST bump `MOTIF_VOCAB_VERSION` so historical aggregates
 * can be recomputed from the WeaknessEvent log (see DESIGN.md §7).
 *
 * Phase 3 ships the 5 detectors listed in DESIGN.md §7 "Phase 3 initial
 * set". Phase 12 polish adds the rest (missed_pin, missed_skewer,
 * overloaded_defender, king_safety_drop, trade_into_bad_endgame).
 */

export const MOTIF_VOCAB_VERSION = 1;

export const MOTIF_IDS = [
  // Phase 3 initial set
  'hanging_piece',
  'missed_capture',
  'missed_fork',
  'back_rank_weakness',
  'missed_mate',
  // Phase 12 additions (declared here so the type accepts them, but no
  // detector ships for them yet — runRuleDetectors won't emit these).
  'missed_pin',
  'missed_skewer',
  'overloaded_defender',
  'king_safety_drop',
  'trade_into_bad_endgame',
] as const;

export type MotifId = (typeof MOTIF_IDS)[number];

/**
 * Runtime guard: is this string a known motif id? Useful when parsing
 * motifs out of untrusted sources (LLM responses, imported PGN, etc.)
 */
export function isKnownMotif(s: string): s is MotifId {
  return (MOTIF_IDS as readonly string[]).includes(s);
}

/** Human-readable short labels, used by the CoachPanel badge row. */
export const MOTIF_LABELS: Record<MotifId, string> = {
  hanging_piece: 'Hanging piece',
  missed_capture: 'Missed capture',
  missed_fork: 'Missed fork',
  back_rank_weakness: 'Back rank',
  missed_mate: 'Missed mate',
  missed_pin: 'Missed pin',
  missed_skewer: 'Missed skewer',
  overloaded_defender: 'Overloaded defender',
  king_safety_drop: 'King safety',
  trade_into_bad_endgame: 'Bad trade',
};
