/**
 * Profile page "Your Story" LLM narrative endpoint.
 *
 * Accepts the structured narrative data (computed client-side by
 * `playerNarrative.ts`) and returns a warmer, LLM-authored paragraph
 * that replaces the template version on the profile page.
 *
 * Follows the same BYOK pattern as `/api/explain-move`.
 */

import {
  CLAUDE_MODEL,
  createClient,
  resolveApiKey,
} from './_lib/anthropicClient';
import { narrativeCache, hash } from './_lib/cache';
import {
  PLAYER_NARRATIVE_SYSTEM_PROMPT,
  buildPlayerNarrativeMessage,
  cleanNarrative,
  type PlayerNarrativeInput,
} from './_lib/prompts/player-narrative';

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

function isValidBody(body: unknown): body is PlayerNarrativeInput {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.templateNarrative === 'string' &&
    b.data != null &&
    typeof b.data === 'object'
  );
}

async function computeCacheKey(input: PlayerNarrativeInput): Promise<string> {
  const d = input.data;
  return hash(
    `narrative|${d.totalGames}|${d.currentLevel}|${d.rollingRating}|${d.topWeaknesses.join(',')}`,
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

  const input: PlayerNarrativeInput = body;

  const cacheKey = await computeCacheKey(input);
  const cached = narrativeCache.get(cacheKey);
  if (cached) {
    return json(200, { narrative: cached, cached: true });
  }

  let narrative: string;
  try {
    const client = createClient(resolved);
    const userMessage = buildPlayerNarrativeMessage(input);
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: PLAYER_NARRATIVE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    narrative = cleanNarrative(parts.join('\n'));
  } catch (err) {
    if (isLikelyAuthError(err)) {
      return json(401, { error: 'invalid_key' });
    }
    console.warn('[player-narrative] upstream error');
    return json(500, { error: 'upstream_error' });
  }

  if (!narrative) {
    return json(500, { error: 'empty_response' });
  }

  narrativeCache.set(cacheKey, narrative);
  return json(200, { narrative, cached: false });
}
