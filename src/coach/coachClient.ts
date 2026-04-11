/**
 * Coach client — template path + Phase 5 profile injection.
 *
 * The public signature matches the full LLM+fallback version sketched
 * in DESIGN.md §6 so that Phase 7 can slot the BYOK proxy in without
 * touching the store or the CoachPanel.
 *
 * Phase 5 addition: if the caller didn't already attach a
 * `profileSummary`, we pull the current one from `profileStore` so
 * template selection can bias toward the player's current weaknesses
 * (see `renderTemplate`). The store access is deliberately late-bound
 * so non-React callers (tests) can still use this client without
 * hydrating localforage.
 */

import { renderTemplate } from './templates';
import type { CoachRequest, CoachResponse } from './types';
import { useProfileStore } from '../profile/profileStore';

export async function getCoachExplanation(
  req: CoachRequest
): Promise<CoachResponse> {
  const enriched: CoachRequest = req.profileSummary
    ? req
    : { ...req, profileSummary: useProfileStore.getState().getProfileSummary() };

  // Phase 7 will gate this behind hasLLM() + fetch('/api/explain-move').
  // For now the template is always the answer.
  return { text: renderTemplate(enriched), source: 'template' };
}
