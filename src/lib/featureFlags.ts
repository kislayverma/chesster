/**
 * Phase 7 feature flags — LLM mode discovery.
 *
 * The app has three possible LLM modes (DESIGN.md §12a):
 *
 *   'off'        — no LLM is available at all. Either the server
 *                  reports it off, the `/api/health` probe failed,
 *                  or we are running in offline/no-network mode.
 *   'byok-only'  — server is willing to accept requests gated by an
 *                  `X-User-API-Key` header. The effective availability
 *                  is then a function of whether the user has pasted
 *                  a key in Settings (see `src/lib/byokStorage.ts`).
 *   'free-tier'  — **Deferred.** Server has a shared quota funded by
 *                  an env `ANTHROPIC_API_KEY`. Not implemented in v1.
 *
 * Discovery flow:
 *
 *   1. On startup, `initLlmMode()` hydrates the BYOK key from
 *      IndexedDB and fires a short-timeout `GET /api/health` probe.
 *   2. The probe's `llmMode` field is cached in memory for the rest
 *      of the session. On failure we force `'off'`.
 *   3. `hasLLM()` is the boolean the coach/tagger ask before making
 *      LLM calls. It is true iff:
 *         • server mode is `'byok-only'` AND the user has a key, OR
 *         • server mode is `'free-tier'` (future).
 *   4. When the user adds or clears their BYOK key, listeners via
 *      `subscribeLlmMode()` fire so the NavShell badge updates live.
 *
 * No network retries: the probe is best-effort. If `/api/health` is
 * unreachable (e.g. running with `npm run dev` instead of `vercel
 * dev`) we silently downgrade to `'off'` and the app keeps working
 * via rule-based templates, which is the whole point of the LLM-
 * optional contract.
 */

import {
  getByokKey,
  hasByokKey,
  hydrateByokKey,
  subscribeByokKey,
} from './byokStorage';

export type LlmMode = 'off' | 'byok-only' | 'free-tier';

const HEALTH_URL = '/api/health';
const HEALTH_TIMEOUT_MS = 800;

type EffectiveMode = LlmMode;
type Listener = (mode: EffectiveMode) => void;

let serverMode: LlmMode = 'off';
let probed = false;
let inFlight: Promise<LlmMode> | null = null;
let invalidKey = false;
const listeners = new Set<Listener>();

/** Notify subscribers with the current effective mode. */
function emit(): void {
  const mode = getLlmMode();
  for (const l of listeners) l(mode);
}

/**
 * Compute the effective LLM mode, combining the server's advertised
 * mode with the current BYOK key state.
 */
export function getLlmMode(): EffectiveMode {
  if (serverMode === 'byok-only') {
    return hasByokKey() ? 'byok-only' : 'off';
  }
  return serverMode;
}

/**
 * True when the coach/tagger should attempt an LLM call.
 */
export function hasLLM(): boolean {
  const mode = getLlmMode();
  return mode === 'byok-only' || mode === 'free-tier';
}

/**
 * Add an `X-User-API-Key` header when the user has a BYOK key. This
 * is the only place in the frontend where the key leaves storage.
 * Called from `coachClient.ts` / `tagMove.ts` right before fetch.
 */
export function withByokHeader(
  headers: Record<string, string> = {}
): Record<string, string> {
  const key = getByokKey();
  if (!key) return headers;
  return { ...headers, 'X-User-API-Key': key };
}

/**
 * Probe `/api/health` and cache the resulting llmMode for the rest of
 * the session. Idempotent — repeated calls return the same promise.
 *
 * A 800ms AbortController timeout keeps this off the critical path:
 * if the proxy is unavailable we fall back to `'off'` within a second
 * and the app boots normally.
 */
export async function initLlmMode(): Promise<LlmMode> {
  if (probed) return serverMode;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Hydrate the BYOK key first so the effective mode is correct on
    // the very first call to `getLlmMode()`.
    await hydrateByokKey();

    // Wire up the BYOK-change listener exactly once. This lets the
    // NavShell badge switch from "off" → "byok" the instant the user
    // saves a key in Settings, without waiting for a re-probe. It
    // also clears any sticky `invalidKey` flag: once the user saves
    // a new key we optimistically assume it works until proven
    // otherwise by the next 401 from the proxy.
    subscribeByokKey(() => {
      invalidKey = false;
      emit();
    });

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const body = (await res.json()) as { llmMode?: unknown };
        if (
          body.llmMode === 'off' ||
          body.llmMode === 'byok-only' ||
          body.llmMode === 'free-tier'
        ) {
          serverMode = body.llmMode;
        } else {
          serverMode = 'off';
        }
      } else {
        serverMode = 'off';
      }
    } catch {
      // Network error, timeout, or /api not mounted (e.g. bare `vite`).
      serverMode = 'off';
    }

    probed = true;
    emit();
    return serverMode;
  })();

  return inFlight;
}

/**
 * Subscribe to LLM-mode changes. Listener is called with the current
 * effective mode immediately upon subscription and again whenever the
 * mode changes (health probe lands, BYOK key added/cleared). Returns
 * an unsubscribe fn.
 */
export function subscribeLlmMode(listener: Listener): () => void {
  listeners.add(listener);
  listener(getLlmMode());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Force the probed mode — used by SettingsPage after the user pastes
 * a key we know is valid, so the coach can start using it immediately
 * without waiting for the next health poll.
 */
export function markServerModeByokOnly(): void {
  serverMode = 'byok-only';
  probed = true;
  emit();
}

/**
 * Called by the coach/tagger when the proxy returns `invalid_key`
 * (Anthropic rejected the user's key with 401/403). The Settings
 * page subscribes to this via `subscribeLlmMode` and shows a banner
 * prompting re-entry. The flag is cleared automatically whenever a
 * new key is saved.
 */
export function markByokInvalid(): void {
  if (invalidKey) return;
  invalidKey = true;
  emit();
}

/** Whether the last coach/tagger call saw an invalid-key rejection. */
export function isByokInvalid(): boolean {
  return invalidKey;
}
