/**
 * Remote BYOK key store.
 *
 * Thin wrapper around the `byok_keys` table on Supabase. The user's
 * Anthropic API key is stored server-side so it persists across
 * devices and survives sign-out / sign-in cycles. The key is fetched
 * on sign-in and cached locally for the session; on sign-out only the
 * local cache is wiped. The backend row is only deleted when the user
 * explicitly clicks "Remove key" in Settings.
 *
 * Error policy: every call returns a boolean or null; failures are
 * logged but never thrown. The local cache remains the source of
 * truth for the running session.
 */

import { getSupabase } from './supabaseClient';

/**
 * Fetch the stored BYOK API key for this user from Supabase.
 * Returns the raw key string, or `null` if no key is stored or
 * Supabase is not configured.
 */
export async function loadByokKeyRemote(
  userId: string,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('byok_keys')
    .select('api_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[remoteByokStore] load failed', error.message);
    return null;
  }

  const row = data as { api_key: string } | null;
  return row?.api_key ?? null;
}

/**
 * Upsert the BYOK API key for this user. Returns true on success.
 */
export async function saveByokKeyRemote(
  userId: string,
  apiKey: string,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('byok_keys')
    .upsert(
      {
        user_id: userId,
        api_key: apiKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.warn('[remoteByokStore] save failed', error.message);
    return false;
  }
  return true;
}

/**
 * Delete the BYOK API key for this user from the backend permanently.
 * Called only when the user explicitly clicks "Remove key" in Settings.
 * Returns true on success.
 */
export async function deleteByokKeyRemote(
  userId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('byok_keys')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.warn('[remoteByokStore] delete failed', error.message);
    return false;
  }
  return true;
}
