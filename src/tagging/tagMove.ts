/**
 * Phase 7 move tagger — rule + LLM union.
 *
 * The rule detectors in `ruleDetectors.ts` are authoritative for the
 * Phase 3 initial motif set. Phase 7 lets the LLM add tags for the
 * harder motifs (missed_pin, missed_skewer, overloaded_defender,
 * king_safety_drop, trade_into_bad_endgame) that we don't have a
 * static detector for yet.
 *
 * Flow (DESIGN.md §6):
 *   1. Always run `runRuleDetectors(ctx)` — this is free, local,
 *      and synchronous-enough to live on the hot path.
 *   2. If the move was good (`best`/`excellent`/`good`/`book`), skip
 *      the LLM call. Good moves don't need extra motifs and we don't
 *      want to spend the user's Anthropic budget on them.
 *   3. If `hasLLM()` is false, return the rule tags unchanged.
 *   4. Otherwise POST to `/api/tag-move` with a short timeout. On
 *      success, UNION the LLM tags into the rule tags (deduped,
 *      constrained to the known vocabulary). The LLM AUGMENTS the
 *      rule path — it never replaces or overrides a rule-tagged
 *      motif.
 *   5. On any failure (network / non-2xx / malformed JSON), return
 *      the rule tags unchanged.
 */

import { isKnownMotif, type MotifId } from './motifs';
import { runRuleDetectors, type DetectorContext } from './ruleDetectors';
import { hasLLM, markByokInvalid, withByokHeader } from '../lib/featureFlags';

export type TagContext = DetectorContext;

const TAG_ENDPOINT = '/api/tag-move';
const LLM_TIMEOUT_MS = 10_000;

function shouldCallLlm(quality: DetectorContext['quality']): boolean {
  if (quality === null) return false;
  if (quality === 'best' || quality === 'excellent' || quality === 'good' || quality === 'book') {
    return false;
  }
  return true;
}

async function tryLlm(ctx: TagContext): Promise<MotifId[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
    const res = await fetch(TAG_ENDPOINT, {
      method: 'POST',
      headers: withByokHeader({ 'content-type': 'application/json' }),
      body: JSON.stringify(ctx),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) {
      markByokInvalid();
      return [];
    }
    if (!res.ok) return [];
    const body = (await res.json()) as { motifs?: unknown };
    if (!Array.isArray(body.motifs)) return [];
    const out: MotifId[] = [];
    for (const m of body.motifs) {
      if (typeof m === 'string' && isKnownMotif(m)) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

function dedupe(list: MotifId[]): MotifId[] {
  const seen = new Set<MotifId>();
  const out: MotifId[] = [];
  for (const m of list) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

export async function tagMove(ctx: TagContext): Promise<MotifId[]> {
  const ruleTags = await runRuleDetectors(ctx);
  if (!shouldCallLlm(ctx.quality)) return ruleTags;
  if (!hasLLM()) return ruleTags;
  const llmTags = await tryLlm(ctx);
  if (llmTags.length === 0) return ruleTags;
  return dedupe([...ruleTags, ...llmTags]);
}
