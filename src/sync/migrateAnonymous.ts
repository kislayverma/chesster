/**
 * Phase 9 anonymous-migration client.
 *
 * Collects everything in local IndexedDB (games + profile) and POSTs
 * it to `/api/migrate-anonymous` in a single call. The server writes
 * it back into the user's rows in one service-role transaction and
 * records an `anon_claims` audit row keyed by the device's stable
 * anon id.
 *
 * Flow:
 *
 *   1. Read the local game index + every persisted tree.
 *   2. Read the local profile (aggregates + full event log).
 *   3. Attach the current Supabase JWT via `Authorization: Bearer`.
 *   4. Include the `anonId` so the server can record the claim and
 *      short-circuit if the same device has already migrated.
 *   5. POST.
 *
 * The server is responsible for:
 *
 *   • Verifying the JWT and pinning `user_id` to `auth.uid()`.
 *   • Rejecting / no-opping if the `anon_id` already has a claim.
 *   • Running all inserts in a single transaction so a failure
 *     part-way through leaves the user's account untouched.
 *
 * A successful migration does NOT wipe local data — the local stores
 * are still the source of truth for the current session. The remote
 * sync orchestrator will refresh from Supabase on the next boot.
 */

import localforage from 'localforage';
import { listGames, loadGame } from '../game/gameStorage';
import { getSupabase } from './supabaseClient';
import { getAnonId } from '../lib/anonId';
import type { PersistedGame, PlayerProfile } from '../profile/types';

const PROFILE_KEY = 'chesster:profile:v1';
const CLAIM_KEY = 'chesster:anon:claim';
const MIGRATE_ENDPOINT = '/api/migrate-anonymous';

export interface MigrationCounts {
  games: number;
  weaknessEvents: number;
  profileTouched: boolean;
}

export interface MigrationResult {
  ok: boolean;
  counts: MigrationCounts;
  error?: string;
}

export interface MigrationSummary {
  anonId: string;
  localGameCount: number;
  localEventCount: number;
  hasLocalProfile: boolean;
}

/**
 * Snapshot of what we would upload. Used by OnboardingPage to decide
 * whether to show the prompt at all — zero-item anon state should
 * just fall through to a "welcome" screen without a migration offer.
 */
export async function summarizeLocalForMigration(): Promise<MigrationSummary> {
  const [index, profile] = await Promise.all([
    listGames(),
    localforage.getItem<PlayerProfile>(PROFILE_KEY),
  ]);
  return {
    anonId: getAnonId(),
    localGameCount: index.length,
    localEventCount: profile?.weaknessEvents?.length ?? 0,
    hasLocalProfile: Boolean(profile && (profile.totalGames > 0 || profile.totalMoves > 0)),
  };
}

/**
 * True when the current device has ALREADY migrated to the active
 * Supabase user. Stored locally (`chesster:anon:claim`) as a simple
 * `{ userId }` pair so we don't need a round-trip to check every
 * app boot.
 */
export async function isAlreadyMigrated(userId: string): Promise<boolean> {
  try {
    const raw = await localforage.getItem<{ userId: string }>(CLAIM_KEY);
    return Boolean(raw && raw.userId === userId);
  } catch {
    return false;
  }
}

async function markMigrated(userId: string): Promise<void> {
  try {
    await localforage.setItem(CLAIM_KEY, { userId });
  } catch {
    // ignore — worst case we re-prompt next boot.
  }
}

/**
 * Walk the local game index and hydrate every full tree. Returns the
 * trees most-recent-first. This can be expensive for large libraries
 * but a Phase 9 anon user has at most a few dozen games.
 */
async function loadAllLocalGames(): Promise<PersistedGame[]> {
  const index = await listGames();
  const games: PersistedGame[] = [];
  for (const entry of index) {
    const g = await loadGame(entry.id);
    if (g) games.push(g);
  }
  return games;
}

/**
 * Skip the server round-trip: mark the current anon device as
 * "claimed to this user" locally. Called from OnboardingPage when
 * the user picks "Start fresh" — we still need to stop re-prompting.
 */
export async function declineMigration(userId: string): Promise<void> {
  await markMigrated(userId);
}

/**
 * Run the migration. The caller MUST already have an active session
 * — returns `{ ok: false }` otherwise.
 */
export async function runMigration(): Promise<MigrationResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, counts: emptyCounts(), error: 'supabase_unavailable' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    return { ok: false, counts: emptyCounts(), error: 'no_session' };
  }

  const userId = session.user.id;

  // Short-circuit if we already claimed on this device for this user.
  if (await isAlreadyMigrated(userId)) {
    return { ok: true, counts: emptyCounts(), error: undefined };
  }

  const [games, profile] = await Promise.all([
    loadAllLocalGames(),
    localforage.getItem<PlayerProfile>(PROFILE_KEY),
  ]);

  const payload = {
    anonId: getAnonId(),
    games,
    profile,
  };

  let res: Response;
  try {
    res = await fetch(MIGRATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network_error';
    return { ok: false, counts: emptyCounts(), error: msg };
  }

  if (!res.ok) {
    let errorCode = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') errorCode = body.error;
    } catch {
      // ignore JSON parse failures
    }
    return { ok: false, counts: emptyCounts(), error: errorCode };
  }

  let body: { ok?: boolean; counts?: Partial<MigrationCounts> };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, counts: emptyCounts(), error: 'bad_response' };
  }

  if (!body.ok) {
    return { ok: false, counts: emptyCounts(), error: 'server_declined' };
  }

  await markMigrated(userId);

  return {
    ok: true,
    counts: {
      games: body.counts?.games ?? 0,
      weaknessEvents: body.counts?.weaknessEvents ?? 0,
      profileTouched: body.counts?.profileTouched ?? false,
    },
  };
}

function emptyCounts(): MigrationCounts {
  return { games: 0, weaknessEvents: 0, profileTouched: false };
}
