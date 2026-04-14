/**
 * Post-game LLM summary endpoint.
 *
 * Accepts the structured game summary data (computed client-side by
 * `gameSummary.ts`) and returns a richer, LLM-authored narrative
 * paragraph that replaces the template version on the review page.
 *
 * Follows the same BYOK pattern as `/api/explain-move` — key via
 * `X-User-API-Key` header, edge runtime, LRU cache, graceful errors.
 */

import {
  CLAUDE_MODEL,
  createClient,
  resolveApiKey,
} from './_lib/anthropicClient';
import { summaryCache, hash } from './_lib/cache';
import {
  SUMMARIZE_GAME_SYSTEM_PROMPT,
  buildSummarizeGameMessage,
  cleanSummary,
  type SummarizeGameInput,
} from './_lib/prompts/summarize-game';

export const config = { runtime: 'edge' };

const MAX_TOKENS = 400;

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

function isValidBody(body: unknown): body is SummarizeGameInput {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.templateNarrative === 'string' &&
    typeof b.totalPlies === 'number' &&
    typeof b.acpl === 'number' &&
    typeof b.blunders === 'number' &&
    typeof b.mistakes === 'number' &&
    typeof b.inaccuracies === 'number'
  );
}

async function computeCacheKey(input: SummarizeGameInput): Promise<string> {
  const profileTag = input.profileSummary?.topMotifs?.join(',') ?? '';
  return hash(
    `summary|${input.totalPlies}|${input.acpl.toFixed(0)}|${input.blunders}|${input.mistakes}|${profileTag}`,
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

  const input: SummarizeGameInput = body;

  const cacheKey = await computeCacheKey(input);
  const cached = summaryCache.get(cacheKey);
  if (cached) {
    return json(200, { summary: cached, cached: true });
  }

  let summary: string;
  try {
    const client = createClient(resolved);
    const userMessage = buildSummarizeGameMessage(input);
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SUMMARIZE_GAME_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    summary = cleanSummary(parts.join('\n'));
  } catch (err) {
    if (isLikelyAuthError(err)) {
      return json(401, { error: 'invalid_key' });
    }
    console.warn('[summarize-game] upstream error');
    return json(500, { error: 'upstream_error' });
  }

  if (!summary) {
    return json(500, { error: 'empty_response' });
  }

  summaryCache.set(cacheKey, summary);
  return json(200, { summary, cached: false });
}
