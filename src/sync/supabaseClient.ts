/**
 * Phase 9 Supabase browser client.
 *
 * Wraps `@supabase/supabase-js` so the rest of the app can import a
 * single stable handle. Two critical design points:
 *
 *   1. **Optional**. If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 *      are missing (the default for the Phase 8 BYOK-only deploy),
 *      `getSupabase()` returns `null`. Everything auth/sync-related
 *      must handle this case and no-op gracefully so the app keeps
 *      running offline with local-only storage.
 *
 *   2. **Singleton**. We build the client lazily on first access and
 *      cache it for the rest of the session. `supabase-js` wires up
 *      `onAuthStateChange` listeners internally; creating multiple
 *      clients would leak listeners across hot reloads.
 *
 * The client uses the **anon key**, which is public-safe — Supabase
 * Row-Level Security is the real access control. The service-role
 * key is never shipped to the browser (it lives only in the
 * `api/migrate-anonymous` serverless function).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let cached: SupabaseClient | null | undefined;

/**
 * Lazily-built browser client. Returns `null` when the build did not
 * include Supabase credentials — callers must treat this as "sync
 * disabled, fall back to local-only" rather than a fatal error.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (!url || !anonKey) {
    cached = null;
    return null;
  }
  try {
    cached = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Magic-link URLs land on `/login` — our LoginPage reads the
        // session out of the URL and redirects onward. The default
        // value `'implicit'` is what we want; setting it explicitly
        // so future supabase-js majors can't silently flip it.
        flowType: 'implicit',
      },
    });
  } catch (err) {
    console.warn('[supabaseClient] createClient failed', err);
    cached = null;
  }
  return cached;
}

/** True when the build shipped with Supabase credentials. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
