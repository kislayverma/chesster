/**
 * Phase 7 BYOK key storage.
 *
 * Persists the user's Anthropic API key in IndexedDB (via localforage)
 * so it survives reloads without ever being written to a cookie or
 * sent to any origin except our own `/api/*` functions.
 *
 * Privacy notes:
 *   • The key never leaves the browser except as an `X-User-API-Key`
 *     header on same-origin requests to `/api/explain-move` and
 *     `/api/tag-move`. Our server uses it for that one request, then
 *     lets the ephemeral `Anthropic` client fall out of scope.
 *   • localforage picks IndexedDB on modern browsers; the payload is
 *     scoped to the Chesster origin.
 *   • `clearByokKey` wipes the record and notifies any subscribers
 *     (see `featureFlags.ts`) so the in-memory copy is dropped too.
 *
 * Only a single key is stored. There is no per-provider selector — if
 * we add OpenAI, Gemini, etc. later we will namespace the storage key.
 */

import localforage from 'localforage';

const STORAGE_KEY = 'chesster:byok:anthropic';

type Listener = (key: string | null) => void;
const listeners = new Set<Listener>();

/** In-memory cache so `hasLLM()` / badge don't need async reads. */
let cachedKey: string | null = null;
let hydrated = false;

/**
 * Load the key from IndexedDB into the in-memory cache. Safe to call
 * repeatedly; only the first call hits storage.
 */
export async function hydrateByokKey(): Promise<string | null> {
  if (hydrated) return cachedKey;
  try {
    const value = await localforage.getItem<string>(STORAGE_KEY);
    cachedKey = typeof value === 'string' && value.length > 0 ? value : null;
  } catch (err) {
    console.warn('[byokStorage] hydrate failed', err);
    cachedKey = null;
  }
  hydrated = true;
  return cachedKey;
}

/** Synchronous accessor — call only after `hydrateByokKey` has resolved. */
export function getByokKey(): string | null {
  return cachedKey;
}

/** Returns true when a non-empty key is cached in memory. */
export function hasByokKey(): boolean {
  return typeof cachedKey === 'string' && cachedKey.length > 0;
}

/**
 * Persist a new key. Accepts the raw key string; minimal validation is
 * done in the UI layer (see `SettingsPage.tsx`) so that this module
 * stays provider-agnostic. Pass `null` to clear.
 */
export async function setByokKey(key: string | null): Promise<void> {
  const normalized = typeof key === 'string' ? key.trim() : '';
  try {
    if (normalized.length === 0) {
      await localforage.removeItem(STORAGE_KEY);
      cachedKey = null;
    } else {
      await localforage.setItem(STORAGE_KEY, normalized);
      cachedKey = normalized;
    }
  } catch (err) {
    console.warn('[byokStorage] setByokKey failed', err);
    return;
  }
  hydrated = true;
  for (const l of listeners) l(cachedKey);
}

/** Convenience: clear the key (equivalent to `setByokKey(null)`). */
export async function clearByokKey(): Promise<void> {
  await setByokKey(null);
}

/**
 * Subscribe to key changes. Fires on every successful `setByokKey` /
 * `clearByokKey`. Returns an unsubscribe function.
 */
export function subscribeByokKey(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Lightweight shape check — Anthropic keys begin with `sk-ant-`.
 * We don't want to hard-fail on an unknown prefix (Anthropic may
 * change it), so this is a soft hint used by the Settings UI.
 */
export function looksLikeAnthropicKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 20 && trimmed.startsWith('sk-ant-');
}
