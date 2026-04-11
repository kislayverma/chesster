/**
 * Phase 3 move tagger — rule-only path.
 *
 * Wraps `runRuleDetectors` behind the same async signature the LLM
 * branch will use in Phase 7 (see DESIGN.md §6). In Phase 3 we always
 * return rule-detector output synchronously wrapped in a resolved
 * promise. When Phase 7 lands, `tagMove` will merge LLM-tagged motifs
 * into the rule tags for low-quality moves, without touching the
 * store or the CoachPanel.
 */

import type { MotifId } from './motifs';
import { runRuleDetectors, type DetectorContext } from './ruleDetectors';

export type TagContext = DetectorContext;

export async function tagMove(ctx: TagContext): Promise<MotifId[]> {
  return runRuleDetectors(ctx);
}
