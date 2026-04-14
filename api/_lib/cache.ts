/**
 * Phase 7 module-level response cache.
 *
 * Per DESIGN.md §12a, the BYOK routes keep an `lru-cache` instance at
 * module scope so warm function instances can return deterministic
 * answers for duplicate prompts without re-hitting Anthropic. The
 * cache is intentionally small and ephemeral:
 *
 *   • Max 256 entries per cache (explain + tag are separate).
 *   • 30-minute TTL — stale coaching is worse than none, and eval
 *     numbers shift as engines improve.
 *   • One instance PER warm function container. A cold start gets a
 *     fresh, empty cache. This is a best-effort speedup, not a
 *     correctness guarantee.
 *
 * Cache keys are SHA-256 digests composed in each route from a
 * request-specific projection (FEN + move + optional profile hash).
 * The `hash` helper below is a thin wrapper around Web Crypto so the
 * routes don't have to pull in `node:crypto`.
 */

import { LRUCache } from 'lru-cache';

const MAX = 256;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Cached coach explanation text, keyed per-request. */
export const explainCache = new LRUCache<string, string>({
  max: MAX,
  ttl: TTL_MS,
});

/** Cached LLM motif lists, keyed per-request. */
export const tagCache = new LRUCache<string, string[]>({
  max: MAX,
  ttl: TTL_MS,
});

/** Cached game summary narratives (post-game LLM review). */
export const summaryCache = new LRUCache<string, string>({
  max: MAX,
  ttl: TTL_MS,
});

/** Cached player narrative (profile-page LLM story). */
export const narrativeCache = new LRUCache<string, string>({
  max: MAX,
  ttl: TTL_MS,
});

/**
 * SHA-256 digest of a string, returned as lowercase hex. Uses the
 * standard Web Crypto API which is available in Vercel's Edge runtime
 * and in modern Node.
 */
export async function hash(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
