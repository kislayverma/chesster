/**
 * Phase 7 BYOK motif tagger endpoint.
 *
 * Flow mirrors `explain-move.ts` but targets the structured-tag path:
 *
 *   1. POST + BYOK key validation.
 *   2. Cache key = sha256(fenBefore + playerMoveUci). No profile hash
 *      because the tag vocabulary is profile-independent.
 *   3. Call Claude with the tag prompt (≤200 tokens — JSON-only).
 *   4. Parse via `parseTagResponse`, which enforces the motif
 *      vocabulary and caps the list at 3. Anything outside the
 *      vocabulary is silently dropped.
 *   5. Respond with `{ motifs: string[] }`. An empty array is a
 *      perfectly valid response ("LLM saw nothing new to add").
 *
 * On any failure, the frontend silently falls back to rule-detector
 * tags only — the tagger never surfaces errors to the user.
 */

import {
  CLAUDE_MODEL,
  createClient,
  resolveApiKey,
} from './_lib/anthropicClient';
import { hash, tagCache } from './_lib/cache';
import {
  TAG_SYSTEM_PROMPT,
  buildTagUserMessage,
  parseTagResponse,
  type TagInput,
} from './_lib/prompts/tag';

export const config = { runtime: 'edge' };

const MAX_TOKENS = 200;

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

function isValidBody(body: unknown): body is TagInput {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.fenBefore === 'string' &&
    typeof b.fenAfter === 'string' &&
    typeof b.playerMoveUci === 'string' &&
    (typeof b.bestMoveBeforeUci === 'string' || b.bestMoveBeforeUci === null) &&
    (typeof b.evalBeforeCp === 'number' || b.evalBeforeCp === null) &&
    (typeof b.evalAfterCp === 'number' || b.evalAfterCp === null) &&
    Array.isArray(b.pvAfter) &&
    (b.moverColor === 'w' || b.moverColor === 'b')
  );
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
  const input: TagInput = body;

  const cacheKey = await hash(`${input.fenBefore}|${input.playerMoveUci}`);
  const cached = tagCache.get(cacheKey);
  if (cached) {
    return json(200, { motifs: cached, cached: true });
  }

  let motifs: string[];
  try {
    const client = createClient(resolved);
    const userMessage = buildTagUserMessage(input);
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: TAG_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    motifs = parseTagResponse(parts.join('\n'));
  } catch (err) {
    if (isLikelyAuthError(err)) {
      return json(401, { error: 'invalid_key' });
    }
    console.warn('[tag-move] upstream error');
    return json(500, { error: 'upstream_error' });
  }

  tagCache.set(cacheKey, motifs);
  return json(200, { motifs, cached: false });
}
