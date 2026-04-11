/**
 * Phase 7 Anthropic client helper — ephemeral per-request construction.
 *
 * Contract (DESIGN.md §12a BYOK flow):
 *
 *   1. Each BYOK request carries an `X-User-API-Key` header with the
 *      user's raw Anthropic key. We build a one-shot `Anthropic`
 *      client scoped to the handler invocation, hand it back to the
 *      route, and let it fall out of scope when the handler returns.
 *   2. The key is NEVER persisted server-side, logged, or shared
 *      across requests. We redact it in any error message that bubbles
 *      up to the client.
 *   3. In a (deferred) `free-tier` mode the server would use
 *      `process.env.ANTHROPIC_API_KEY` instead. We preserve that path
 *      here behind `resolveApiKey` so the routes don't have to know
 *      which mode is active.
 *
 * The routes should ALWAYS call `resolveApiKey(req)` first and bail
 * with a 401 if the result is `null`, never allowing an unauthed call
 * through to `createClient`.
 */

import Anthropic from '@anthropic-ai/sdk';

/** Claude model id used for every BYOK call. Kept in one place so we
 *  can roll forward without touching every handler. */
export const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

export interface ResolvedKey {
  apiKey: string;
  source: 'byok' | 'server';
}

/**
 * Extract the caller's Anthropic key from the request, preferring the
 * BYOK header. Returns `null` when no key is available, in which case
 * the route must respond with `401 invalid_key`.
 */
export function resolveApiKey(req: Request): ResolvedKey | null {
  const headerKey = req.headers.get('x-user-api-key')?.trim();
  if (headerKey && headerKey.length > 0) {
    return { apiKey: headerKey, source: 'byok' };
  }
  // Deferred free-tier path. Not exercised in v1; present for symmetry.
  const envKey = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.ANTHROPIC_API_KEY;
  if (typeof envKey === 'string' && envKey.length > 0) {
    return { apiKey: envKey, source: 'server' };
  }
  return null;
}

/**
 * Build a single-use Anthropic SDK client from a resolved key. The
 * returned client must not be cached — we want the key reference to
 * disappear the moment the request completes.
 */
export function createClient(resolved: ResolvedKey): Anthropic {
  return new Anthropic({ apiKey: resolved.apiKey });
}

/** Best-effort key redaction for logs. Turns sk-ant-api03-abc123... into sk-ant-***. */
export function redactKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 7)}***`;
}
