/**
 * Phase 7 BYOK coaching endpoint.
 *
 * Flow (DESIGN.md §6, §12, §12a):
 *
 *   1. Validate method + body. Only POST is allowed.
 *   2. Extract an ephemeral Anthropic key via `resolveApiKey`. If
 *      neither the `X-User-API-Key` header nor a free-tier env key
 *      is present, return `401 {"error":"invalid_key"}`.
 *   3. Build a cache key = sha256(fenBefore + playerMove + profileHash)
 *      and consult the module-level `explainCache`. Warm instances
 *      return instantly.
 *   4. Call Claude with a 300-token cap (mirrors the "one short
 *      paragraph" contract in DESIGN.md §6).
 *   5. Strip any stray preamble via `cleanExplanation`, store in the
 *      cache, return `{ explanation }`.
 *   6. On upstream 401/403 we map to `{ error: 'invalid_key' }` with
 *      status 401 so the frontend can show the "re-enter your key"
 *      banner in Settings (see `featureFlags.ts` subscribers).
 *   7. Any other failure becomes `500 {"error":"upstream_error"}`
 *      and the frontend silently falls back to templates.
 *
 * The Anthropic key is NEVER logged, NEVER persisted, and NEVER
 * attached to the response. Any error surface scrubs it via
 * `redactKey` before stringification.
 */

import {
  CLAUDE_MODEL,
  createClient,
  resolveApiKey,
} from './_lib/anthropicClient';
import { explainCache, hash } from './_lib/cache';
import {
  EXPLAIN_SYSTEM_PROMPT,
  buildExplainUserMessage,
  cleanExplanation,
  type ExplainInput,
} from './_lib/prompts/explain';

export const config = { runtime: 'edge' };

const MAX_TOKENS = 300;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function isLikelyAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number };
  return e.status === 401 || e.status === 403;
}

function isValidBody(body: unknown): body is ExplainInput {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.fenBefore === 'string' &&
    typeof b.playerMove === 'string' &&
    typeof b.bestMove === 'string' &&
    Array.isArray(b.pv) &&
    typeof b.quality === 'string' &&
    typeof b.cpLoss === 'number' &&
    Array.isArray(b.motifs) &&
    typeof b.phase === 'string'
  );
}

async function computeCacheKey(input: ExplainInput): Promise<string> {
  const profileTag = input.profileSummary?.topMotifs?.join(',') ?? '';
  return hash(`${input.fenBefore}|${input.playerMove}|${profileTag}`);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const resolved = resolveApiKey(req);
  if (!resolved) {
    return json(401, { error: 'invalid_key' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (!isValidBody(body)) {
    return json(400, { error: 'bad_request' });
  }

  const input: ExplainInput = body;

  const cacheKey = await computeCacheKey(input);
  const cached = explainCache.get(cacheKey);
  if (cached) {
    return json(200, { explanation: cached, cached: true });
  }

  let explanation: string;
  try {
    const client = createClient(resolved);
    const userMessage = buildExplainUserMessage(input);
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: EXPLAIN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Anthropic SDK returns a content array; we concatenate text blocks.
    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    explanation = cleanExplanation(parts.join('\n'));
  } catch (err) {
    if (isLikelyAuthError(err)) {
      return json(401, { error: 'invalid_key' });
    }
    // Intentionally opaque — any detail could leak the key or model id.
    console.warn('[explain-move] upstream error');
    return json(500, { error: 'upstream_error' });
  }

  if (!explanation) {
    return json(500, { error: 'empty_response' });
  }

  explainCache.set(cacheKey, explanation);
  return json(200, { explanation, cached: false });
}
