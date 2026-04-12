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
 * Sign-in flow gotcha: the handler intentionally does NOTHING when
 * `isAlreadyMigrated(userId)` is false. If we blindly replaced the
 * local profile + games on first sign-in, we'd nuke the anonymous
 * user's unmigrated data before the Onboarding screen even mounts.
 * Onboarding is responsible for calling `hydrateFromRemote` itself
 * once the migration decision has been recorded.
 *
 * Sign-out policy: local IndexedDB is preserved. The user can keep
 * playing anonymously with their library intact, and signing back in
 * as the same user re-triggers the hydrate. Signing in as a different
 * user on the same device would merge data — out of scope for the
 * Phase 9 MVP (see DESIGN.md §12a future-work notes).
 */

import {
  setOnSignInHandler,
  setOnSignOutHandler,
  useAuthStore,
} from '../auth/authStore';
import { isAlreadyMigrated } from './migrateAnonymous';
import { loadProfileRemote, saveProfileRemote } from './remoteProfileStore';
import { loadAllGamesRemote, saveGameRemote } from './remoteGameStore';
import { loadAllCardsRemote, saveCardRemote } from './remotePracticeStore';
import { writePersistedGame } from '../game/gameStorage';
import { useProfileStore } from '../profile/profileStore';
import { usePracticeStore } from '../srs/practiceStore';
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
    // Wait for the migration flow to finalize before touching local
    // data on this device. See the module header for rationale.
    if (!(await isAlreadyMigrated(userId))) return;
    await hydrateFromRemote(userId);
  });

  setOnSignOutHandler(() => {
    // Intentionally no-op: keep local stores intact so the user can
    // keep playing as anon. The auth store itself already cleared
    // `user`/`session`, so `pushGameRemote` / `pushProfileRemote`
    // will short-circuit on the next mutation.
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
