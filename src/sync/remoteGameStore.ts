/**
 * Phase 9 remote game store.
 *
 * Thin wrapper around the `games` table on Supabase. Mirrors the
 * public surface of `src/game/gameStorage.ts` but every call goes
 * through the anon-key client and is gated on an active session.
 *
 * Shape compatibility: the on-disk `PersistedGame` maps 1:1 onto the
 * `games` row, with the full tree stored inline as JSONB. That keeps
 * the adapter trivial — no field-level column mapping, no tree
 * re-serialization.
 *
 * Errors are swallowed and logged. Remote sync is best-effort; the
 * local IndexedDB copy is always the source of truth for the running
 * session, so a dropped save becomes a retry on the next move.
 */

import { getSupabase } from './supabaseClient';
import type { PersistedGame, PersistedGameIndexEntry } from '../profile/types';

/** Shape of a row in `public.games`. Mirrors `supabase/schema.sql`. */
interface GameRow {
  id: string;
  user_id: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  result: string | null;
  mainline_plies: number;
  engine_enabled: boolean;
  human_color: 'w' | 'b';
  tree: unknown;
  created_at?: string;
}

function rowToPersisted(row: GameRow): PersistedGame {
  return {
    id: row.id,
    startedAt: Date.parse(row.started_at),
    updatedAt: Date.parse(row.updated_at),
    finishedAt: row.finished_at ? Date.parse(row.finished_at) : null,
    result: row.result,
    mainlinePlies: row.mainline_plies,
    engineEnabled: row.engine_enabled,
    humanColor: row.human_color,
    // The DB column is a jsonb — it deserializes to an object that
    // already matches `SerializedGameTree`. We trust the shape
    // because every write in the app goes through this same module.
    tree: row.tree as PersistedGame['tree'],
  };
}

function rowToIndexEntry(row: GameRow): PersistedGameIndexEntry {
  return {
    id: row.id,
    startedAt: Date.parse(row.started_at),
    updatedAt: Date.parse(row.updated_at),
    finishedAt: row.finished_at ? Date.parse(row.finished_at) : null,
    result: row.result,
    mainlinePlies: row.mainline_plies,
    humanColor: row.human_color,
    engineEnabled: row.engine_enabled,
  };
}

function persistedToRow(game: PersistedGame, userId: string): GameRow {
  return {
    id: game.id,
    user_id: userId,
    started_at: new Date(game.startedAt).toISOString(),
    updated_at: new Date(game.updatedAt).toISOString(),
    finished_at: game.finishedAt ? new Date(game.finishedAt).toISOString() : null,
    result: game.result,
    mainline_plies: game.mainlinePlies,
    engine_enabled: game.engineEnabled,
    human_color: game.humanColor,
    tree: game.tree,
  };
}

/**
 * Upsert a single game row. Returns true on success, false on any
 * failure. Never throws — a remote-sync failure must never break the
 * local play loop.
 */
export async function saveGameRemote(
  userId: string,
  game: PersistedGame
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from('games')
    .upsert(persistedToRow(game, userId), { onConflict: 'id' });
  if (error) {
    console.warn('[remoteGameStore] saveGame failed', error.message);
    return false;
  }
  return true;
}

/**
 * Download the list of games for this user, returned in the same
 * shape as `gameStorage.listGames()` (most-recent-first). Caller is
 * responsible for merging with the local index.
 */
export async function listGamesRemote(
  userId: string
): Promise<PersistedGameIndexEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('games')
    .select(
      'id,user_id,started_at,updated_at,finished_at,result,mainline_plies,engine_enabled,human_color,tree'
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) {
    if (error) console.warn('[remoteGameStore] listGames failed', error.message);
    return [];
  }
  return data.map(rowToIndexEntry);
}

/**
 * Download a single game with its full tree. Caller is responsible
 * for writing it back to IndexedDB via `gameStorage.saveGame`.
 */
export async function loadGameRemote(
  userId: string,
  id: string
): Promise<PersistedGame | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn('[remoteGameStore] loadGame failed', error.message);
    return null;
  }
  return rowToPersisted(data);
}

/**
 * Bulk download ALL games for this user (full trees). Used once on
 * sign-in by the sync orchestrator, then never again during the
 * session. Returned games are sorted most-recent-first.
 */
export async function loadAllGamesRemote(
  userId: string
): Promise<PersistedGame[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) {
    if (error)
      console.warn('[remoteGameStore] loadAllGames failed', error.message);
    return [];
  }
  return data.map(rowToPersisted);
}

export async function deleteGameRemote(
  userId: string,
  id: string
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from('games')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) {
    console.warn('[remoteGameStore] deleteGame failed', error.message);
    return false;
  }
  return true;
}
