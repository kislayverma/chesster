/**
 * Phase 7 health probe — always-mounted.
 *
 * Tells the frontend which LLM mode this deployment supports. The
 * `src/lib/featureFlags.ts::initLlmMode` helper hits this on startup
 * and caches the result for the session.
 *
 * Response shape (mirrors DESIGN.md §12):
 *   { "llmMode": "off" | "byok-only" | "free-tier" }
 *
 * Selection rules:
 *   • If `DISABLE_LLM_PROXY=1` is set in the environment, return
 *     `'off'` — useful for private deployments that want to hard-
 *     disable the LLM path regardless of installed deps.
 *   • If the deferred free-tier is wired (both `ANTHROPIC_API_KEY`
 *     set AND `FREE_TIER_DAILY_CAP_CENTS` > 0), return `'free-tier'`.
 *     **Not implemented in v1.** The check is here so rolling it on
 *     later is a one-env-var change.
 *   • Otherwise return `'byok-only'` — the default posture. The
 *     actual availability at call time then depends on whether the
 *     user has pasted a key in Settings.
 */

export const config = { runtime: 'edge' };

type LlmMode = 'off' | 'byok-only' | 'free-tier';

function readEnv(name: string): string | undefined {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  return env?.[name];
}

function resolveLlmMode(): LlmMode {
  if (readEnv('DISABLE_LLM_PROXY') === '1') return 'off';
  const serverKey = readEnv('ANTHROPIC_API_KEY');
  const capRaw = readEnv('FREE_TIER_DAILY_CAP_CENTS');
  const cap = capRaw ? Number.parseInt(capRaw, 10) : 0;
  if (serverKey && Number.isFinite(cap) && cap > 0) return 'free-tier';
  return 'byok-only';
}

export default async function handler(_req: Request): Promise<Response> {
  const mode: LlmMode = resolveLlmMode();
  return new Response(JSON.stringify({ llmMode: mode }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
