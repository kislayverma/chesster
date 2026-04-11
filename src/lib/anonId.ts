/**
 * Phase 9 anonymous device identifier.
 *
 * Generates and persists a stable UUID for this browser, used to stamp
 * anonymous local data so the Phase 9 migration function can:
 *
 *   1. Link it to a user id on first sign-in via `anon_claims`.
 *   2. Be idempotent: replaying the migration for the same anon_id is
 *      a no-op (the `anon_claims` primary key blocks duplicates).
 *
 * Why `localStorage` and not `localforage`/IndexedDB?
 *
 *   • `localStorage` is synchronous, so the id is available the
 *     instant any module imports `getAnonId()`. No `await` chain.
 *   • It is slightly more robust against accidental IndexedDB wipes
 *     (some browsers clear IDB storage independently).
 *   • The value is a single small string — we're not paying for the
 *     sync API's quota limits.
 *
 * The id is regenerated only if localStorage is unreadable (private-mode
 * Safari, disabled storage, etc.) — in that case we fall back to a
 * session-scoped id that at least lets the current tab migrate cleanly.
 */

const STORAGE_KEY = 'chesster:anonId';

let cached: string | null = null;

/**
 * Return the stable device anon id, generating one on first call.
 * Safe to call synchronously from any module; never throws.
 */
export function getAnonId(): string {
  if (cached) return cached;

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && isUuidLike(existing)) {
      cached = existing;
      return existing;
    }
  } catch {
    // localStorage may throw in private mode or when disabled.
  }

  const fresh = generateUuid();
  cached = fresh;
  try {
    window.localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // Fall back to a session-only id — better than crashing.
  }
  return fresh;
}

/**
 * Reset the cached anon id. Used by `clearLocalData()` in Settings so
 * a fresh start actually looks fresh to the migration pipeline.
 */
export function clearAnonId(): void {
  cached = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function generateUuid(): string {
  // Prefer the web-crypto `randomUUID` when available (all modern
  // browsers since 2022), fall back to a Math.random hex blob.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4 variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
