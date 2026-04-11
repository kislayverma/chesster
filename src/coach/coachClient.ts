/**
 * Coach client — Phase 7 LLM-first with template fallback.
 *
 * Flow:
 *   1. Inject a fresh `profileSummary` from the profile store if the
 *      caller didn't supply one (Phase 5 behavior preserved). This
 *      gets sent to the LLM for personalization AND fed to the local
 *      template fallback so the bias toward recurring weaknesses is
 *      consistent across both paths.
 *   2. If `hasLLM()` is true (server advertised `byok-only`/`free-tier`
 *      AND the user has a key), POST to `/api/explain-move` with the
 *      `X-User-API-Key` header attached by `withByokHeader`. On a 2xx
 *      response, return the LLM text tagged `source: 'llm'`.
 *   3. On ANY failure — network error, non-2xx, malformed body — we
 *      silently fall through to the template path. This preserves
 *      the LLM-optional contract in DESIGN.md §6: the player never
 *      sees a broken coach panel because the proxy hiccuped.
 *
 * The Anthropic key itself is read inside `withByokHeader` and never
 * stored on this module's scope. We deliberately do not log the key
 * or the full request body.
 */

import { renderTemplate } from './templates';
import type { CoachRequest, CoachResponse } from './types';
import { useProfileStore } from '../profile/profileStore';
import { hasLLM, markByokInvalid, withByokHeader } from '../lib/featureFlags';

const EXPLAIN_ENDPOINT = '/api/explain-move';
const LLM_TIMEOUT_MS = 15_000;

async function tryLlm(req: CoachRequest): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
    const res = await fetch(EXPLAIN_ENDPOINT, {
      method: 'POST',
      headers: withByokHeader({ 'content-type': 'application/json' }),
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) {
      markByokInvalid();
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { explanation?: unknown };
    if (typeof body.explanation === 'string' && body.explanation.trim().length > 0) {
      return body.explanation.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export async function getCoachExplanation(
  req: CoachRequest
): Promise<CoachResponse> {
  const enriched: CoachRequest = req.profileSummary
    ? req
    : { ...req, profileSummary: useProfileStore.getState().getProfileSummary() };

  if (hasLLM()) {
    const llmText = await tryLlm(enriched);
    if (llmText) {
      return { text: llmText, source: 'llm' };
    }
  }

  return { text: renderTemplate(enriched), source: 'template' };
}
