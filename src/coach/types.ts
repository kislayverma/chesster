/**
 * Phase 3 coach types.
 *
 * Matches the shapes declared in DESIGN.md §6. `profileSummary` is
 * declared here so the Phase 7 BYOK proxy has a place to inject
 * personalization, but the Phase 3 template path ignores it.
 */

import type { MoveQuality } from '../game/moveClassifier';
import type { GamePhase } from '../tagging/phaseDetector';
import type { MotifId } from '../tagging/motifs';

/**
 * A trimmed view of the player's weakness profile sent along with
 * coaching requests. Populated by Phase 5 (profileStore).
 *
 * `topMotifs` is the bare id list (handy for log lines and LLM prompts);
 * `topWeaknesses` is the same list with raw + decayed counts so the
 * template layer can decide whether to append a reinforcement suffix
 * ("this is the 4th time you've hung a piece this week").
 */
export interface ProfileSummary {
  topMotifs: string[];
  topWeaknesses: { motif: string; count: number; decayedCount: number }[];
  phaseCpLoss: { opening: number; middlegame: number; endgame: number };
  /** Total games played (enriches LLM context for summary/narrative). */
  totalGames?: number;
  /** Current journey level key (e.g. 'clubPlayer'). */
  currentLevel?: string;
}

export interface CoachRequest {
  fenBefore: string;
  /** SAN of the move the player actually played. */
  playerMove: string;
  /** SAN of the engine's top choice in the pre-move position (may be empty). */
  bestMove: string;
  /** Principal variation from the post-move analysis (UCI). */
  pv: string[];
  quality: MoveQuality;
  /** Mover-perspective centipawn loss. */
  cpLoss: number;
  motifs: MotifId[];
  phase: GamePhase;
  profileSummary?: ProfileSummary;
}

export interface CoachResponse {
  text: string;
  source: 'llm' | 'template';
}
