/**
 * Phase 9 sync orchestrator.
 *
 * Single module that owns the "remote data arriving" and "remote data
 * leaving" sides of Supabase sync:
 *
 *   • Registers `onSignIn` / `onSignOut` handlers with `authStore`.
 *     Called once at app boot by `main.tsx` via `initSyncOrchestrator()`.
 *
 *   • Exposes `hydrateFromRemote(userId)` — the imperative
 *     "download everything from Supabase and replace local state"
 *     operation. Used both by the onSignIn handler AND by
 *     `OnboardingPage` right after a migration decision is finalized,
 *     so a fresh sign-in on a new device pulls the user's existing
 *     library even if they clicked "Start fresh" on this device.
 *
 *   • Exposes `pushGameRemote` / `pushProfileRemote` — fire-and-forget
 *     write hooks that `gameStore.persistTree` and `profileStore`
 *     call on every local mutation. They silently no-op when there
 *     is no authenticated session, so anonymous play never reaches
 *     for the network.
 *
 * Sign-in flow: the handler checks `isAlreadyMigrated(userId)`. If
 * true, it hydrates immediately. If false, it probes for a remote
 * profile — a returning user whose local claim was cleared (e.g.
 * via "Clear all local data") will have `totalGames > 0` on the
 * server, so we re-mark the claim and hydrate without routing
 * through onboarding. Only genuinely new sign-ins (no remote data)
 * are left for the OnboardingPage to handle.
 *
 * Sign-out policy: all local data is wiped — IndexedDB (games,
 * profile, practice cards, migration claim), the local BYOK key
 * cache, and the anonymous device id. This ensures a clean slate
 * so a different user can sign in without seeing stale data.
 * Signing back in as the same user re-triggers `hydrateFromRemote`
 * which pulls everything back down from Supabase — including the
 * BYOK key from the `byok_keys` table. The backend BYOK key is
 * only deleted when the user explicitly clicks "Remove key" in
 * Settings.
 */

import localforage from 'localforage';
import {
  setOnSignInHandler,
  setOnSignOutHandler,
  useAuthStore,
} from '../auth/authStore';
import { declineMigration, isAlreadyMigrated } from './migrateAnonymous';
import { loadProfileRemote, saveProfileRemote } from './remoteProfileStore';
import { loadAllGamesRemote, saveGameRemote } from './remoteGameStore';
import { loadAllCardsRemote, saveCardRemote } from './remotePracticeStore';
import { writePersistedGame } from '../game/gameStorage';
import { useProfileStore } from '../profile/profileStore';
import { usePracticeStore } from '../srs/practiceStore';
import { useGameStore } from '../game/gameStore';
import { clearByokKey, setByokKey } from '../lib/byokStorage';
import { markServerModeByokOnly } from '../lib/featureFlags';
import { loadByokKeyRemote, saveByokKeyRemote, deleteByokKeyRemote } from './remoteByokStore';
import { clearAnonId } from '../lib/anonId';
import type { PersistedGame, PlayerProfile } from '../profile/types';
import type { PracticeCard } from '../srs/types';

let initialized = false;

/**
 * Wire up the auth-store handlers. Safe to call multiple times — the
 * second call is a no-op.
 */
export function initSyncOrchestrator(): void {
  if (initialized) return;
  initialized = true;

  setOnSignInHandler(async (session) => {
    const userId = session.user.id;

    if (await isAlreadyMigrated(userId)) {
      // Normal returning sign-in — hydrate from server.
      await hydrateFromRemote(userId);
      return;
    }

    // The claim is missing. This is either a genuinely new sign-in or a
    // returning user whose claim was cleared (e.g. "Clear all local data").
    // Check the server: if a profile with games exists, this is a returning
    // user — re-mark the claim and hydrate immediately instead of routing
    // through onboarding.
    const remoteProfile = await loadProfileRemote(userId);
    if (remoteProfile && remoteProfile.totalGames > 0) {
      await declineMigration(userId);
      await hydrateFromRemote(userId);
      return;
    }

    // Genuinely first sign-in — let OnboardingPage handle migration.
  });

  setOnSignOutHandler(async () => {
    // Wipe all local data so a different user can sign in cleanly.

    // 1. Reset in-memory Zustand stores.
    useProfileStore.getState().clearProfile();
    usePracticeStore.getState().replaceCards([]);
    useGameStore.getState().reset();

    // 2. Clear BYOK key locally (in-memory cache + IndexedDB).
    //    The backend copy is preserved — it will be fetched again on
    //    the next sign-in. Only an explicit "Remove key" in Settings
    //    deletes the backend row.
    await clearByokKey();

    // 3. Wipe all IndexedDB entries (games, profile, practice cards,
    //    migration claim, etc.).
    try {
      await localforage.clear();
    } catch {
      // best effort
    }

    // 4. Clear localStorage anon device id.
    clearAnonId();
  });
}

/**
 * Download the user's profile + games from Supabase and write them
 * into the local stores, replacing whatever is currently there. Safe
 * to call repeatedly — every remote read is a point-in-time snapshot
 * and every local write is an idempotent upsert.
 */
export async function hydrateFromRemote(userId: string): Promise<void> {
  const { _setSyncing } = useAuthStore.getState();
  _setSyncing(true);
  try {
    // Profile first so the coach has fresh weakness data as soon as
    // the user lands on the board, even if games are still streaming.
    const remoteProfile = await loadProfileRemote(userId);
    if (remoteProfile) {
      useProfileStore.getState().replaceProfile(remoteProfile);
    }

    // Games are bulk-downloaded and written straight to IndexedDB.
    // `writePersistedGame` preserves the server's `updated_at`
    // timestamp so subsequent remote saves don't loop.
    const games = await loadAllGamesRemote(userId);
    for (const g of games) {
      await writePersistedGame(g);
    }

    // Phase 6: pull practice cards last (they reference events which
    // must already be in place for foreign-key integrity).
    const cards = await loadAllCardsRemote(userId);
    if (cards.length > 0) {
      usePracticeStore.getState().replaceCards(cards);
    }

    // BYOK key: fetch from backend and cache locally so the user
    // doesn't have to re-enter it on every new device / sign-in.
    const remoteKey = await loadByokKeyRemote(userId);
    if (remoteKey) {
      await setByokKey(remoteKey);
      markServerModeByokOnly();
    }
  } catch (err) {
    console.warn('[syncOrchestrator] hydrate failed', err);
  } finally {
    _setSyncing(false);
  }
}

/**
 * Fire-and-forget: upsert a single `PersistedGame` to Supabase if the
 * user is signed in. Called from `gameStore.persistTree` after the
 * local write succeeds. Errors are swallowed — the local IndexedDB
 * copy remains the source of truth.
 */
export function pushGameRemote(game: PersistedGame): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  void saveGameRemote(userId, game).catch((err) => {
    console.warn('[syncOrchestrator] pushGame failed', err);
  });
}

/**
 * Fire-and-forget: upsert the `PlayerProfile` (scalar aggregates +
 * the full weakness event log) to Supabase if the user is signed in.
 * Called from `profileStore` via the debounced save path.
 */
export function pushProfileRemote(profile: PlayerProfile): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  void saveProfileRemote(userId, profile).catch((err) => {
    console.warn('[syncOrchestrator] pushProfile failed', err);
  });
}

/**
 * Fire-and-forget: upsert a single `PracticeCard` to Supabase if the
 * user is signed in. Called from `practiceStore` via the debounced
 * save path (dynamically imported to break the load-time cycle).
 */
export function pushCardRemote(card: PracticeCard): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  void saveCardRemote(userId, card).catch((err) => {
    console.warn('[syncOrchestrator] pushCard failed', err);
  });
}

/**
 * Fire-and-forget: upsert the user's BYOK API key to Supabase so it
 * persists across devices. Called from `SettingsPage` after the user
 * saves a key. No-op when not authenticated.
 */
export function pushByokKeyRemote(apiKey: string): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  void saveByokKeyRemote(userId, apiKey).catch((err) => {
    console.warn('[syncOrchestrator] pushByokKey failed', err);
  });
}

/**
 * Fire-and-forget: permanently delete the user's BYOK API key from
 * Supabase. Called from `SettingsPage` when the user clicks "Remove
 * key". No-op when not authenticated.
 */
export function removeByokKeyRemote(): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  void deleteByokKeyRemote(userId).catch((err) => {
    console.warn('[syncOrchestrator] removeByokKey failed', err);
  });
}
