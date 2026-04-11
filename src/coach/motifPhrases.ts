/**
 * Phase 3 per-motif one-liners.
 *
 * Short descriptive phrases keyed by motif id. Used by the template
 * renderer to stitch a motif mention into the longer explanation
 * sentence, and by the CoachPanel badge row as a tooltip.
 *
 * These are deliberately generic. The templates in `templates.ts`
 * add the context (quality, phase, specific move), while these are
 * just the "what" of each motif.
 */

import type { MotifId } from '../tagging/motifs';

export const MOTIF_PHRASES: Record<MotifId, string> = {
  hanging_piece: 'this move leaves a piece undefended — the opponent can just take it',
  missed_capture: 'there was a free piece to grab and you walked past it',
  missed_fork: "the engine's move attacked two pieces at once — a fork you could have played",
  back_rank_weakness: 'your king has no escape squares on the back rank, and this move ignored the threat',
  missed_mate: 'there was a forced mate in the position and this move gave it up',
  missed_pin: 'a pin was available to restrict the opponent, but this move missed it',
  missed_skewer: 'a skewer would have won material by forcing the front piece to move',
  overloaded_defender: 'one defender was guarding too many pieces — you could have exploited it',
  king_safety_drop: 'this move weakened your king position without compensation',
  trade_into_bad_endgame: 'the resulting endgame favors the opponent',
};
