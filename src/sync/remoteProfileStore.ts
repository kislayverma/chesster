/**
 * Phase 9 remote profile store.
 *
 * The local `PlayerProfile` has two logical halves:
 *
 *   1. Scalar aggregates + derived fields (`totalGames`, `totalMoves`,
 *      `motifCounts`, `phaseCpLoss`, `openingWeaknesses`, `acplHistory`).
 *      These live in the `profiles` table as a single row per user.
 *
 *   2. The append-only `weaknessEvents` log. Each event is a row in
 *      the `weakness_events` table, keyed by its client-generated id
 *      (`{gameId}:{nodeId}`). The local store is the source of truth
 *      for derivation — `profileAggregates.recomputeAggregates` can
 *      always rebuild half #1 from half #2 — so on a remote reload
 *      we pull the events, rebuild, and the aggregates come along
 *      for free.
 *
 * Save strategy:
 *
 *   • On every debounced save, upsert the profiles row.
 *   • On every save, upsert ALL weaknessEvents via a single bulk
 *     `upsert(..., { onConflict: 'id' })`. Postgres trivially dedupes
 *     on the primary key, so this is idempotent and cheaper than
 *     maintaining an explicit "last-synced-event" cursor.
 *
 * Error policy: every call returns a boolean; failures are logged
 * but never thrown. The local store remains the source of truth for
 * the running session.
 */

import { getSupabase } from './supabaseClient';
import { recomputeAggregates } from '../profile/profileAggregates';
import type { PlayerProfile, WeaknessEvent } from '../profile/types';
import type { MotifId } from '../tagging/motifs';
import type { MoveQuality } from '../game/moveClassifier';
import type { GamePhase } from '../tagging/phaseDetector';

/** Check that a journey_state value from the DB has the required fields. */
function isValidJourneyState(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.calibrationGamesPlayed === 'number';
}

interface ProfileRow {
  user_id: string;
  total_games: number;
  total_moves: number;
  motif_counts: unknown;
  phase_cp_loss: unknown;
  opening_weaknesses: unknown;
  acpl_history: unknown;
  journey_state: unknown;
  created_at?: string;
  updated_at: string;
}

interface WeaknessEventRow {
  id: string;
  user_id: string;
  game_id: string;
  move_number: number;
  fen: string;
  player_move: string;
  best_move: string;
  cp_loss: number;
  quality: MoveQuality;
  phase: GamePhase;
  motifs: string[];
  eco: string | null;
  color: 'white' | 'black';
  ts: string;
}

function profileToRow(p: PlayerProfile, userId: string): ProfileRow {
  return {
    user_id: userId,
    total_games: p.totalGames,
    total_moves: p.totalMoves,
    motif_counts: p.motifCounts,
    phase_cp_loss: p.phaseCpLoss,
    opening_weaknesses: p.openingWeaknesses,
    acpl_history: p.acplHistory,
    journey_state: p.journeyState,
    created_at: new Date(p.createdAt).toISOString(),
    updated_at: new Date(p.updatedAt).toISOString(),
  };
}

function eventToRow(e: WeaknessEvent, userId: string): WeaknessEventRow {
  return {
    id: e.id,
    user_id: userId,
    game_id: e.gameId,
    move_number: e.moveNumber,
    fen: e.fen,
    player_move: e.playerMove,
    best_move: e.bestMove,
    cp_loss: e.cpLoss,
    quality: e.quality as 'inaccuracy' | 'mistake' | 'blunder',
    phase: e.phase,
    motifs: e.motifs,
    eco: e.eco ?? null,
    color: e.color,
    ts: new Date(e.timestamp).toISOString(),
  };
}

function rowToEvent(r: WeaknessEventRow): WeaknessEvent {
  return {
    id: r.id,
    gameId: r.game_id,
    moveNumber: r.move_number,
    fen: r.fen,
    playerMove: r.player_move,
    bestMove: r.best_move,
    cpLoss: r.cp_loss,
    quality: r.quality,
    phase: r.phase,
    motifs: r.motifs as MotifId[],
    eco: r.eco ?? undefined,
    color: r.color,
    timestamp: Date.parse(r.ts),
  };
}

/**
 * Push the aggregate row + any weakness events for this user.
 * Returns `true` when both upserts succeed (or when there is nothing
 * to push).
 */
export async function saveProfileRemote(
  userId: string,
  profile: PlayerProfile
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  let ok = true;

  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert(profileToRow(profile, userId), { onConflict: 'user_id' });
  if (profileErr) {
    console.warn('[remoteProfileStore] upsert profile failed', profileErr.message);
    ok = false;
  }

  if (profile.weaknessEvents.length > 0) {
    const rows = profile.weaknessEvents.map((e) => eventToRow(e, userId));
    const { error: eventsErr } = await supabase
      .from('weakness_events')
      .upsert(rows, { onConflict: 'id' });
    if (eventsErr) {
      console.warn(
        '[remoteProfileStore] upsert events failed',
        eventsErr.message
      );
      ok = false;
    }
  }

  return ok;
}

/**
 * Download the full profile for this user from Supabase and return
 * a rebuilt `PlayerProfile`. Aggregates are recomputed locally from
 * the event log via `recomputeAggregates` so the decay window reflects
 * "now" rather than the last save time.
 *
 * Returns `null` when the user has no remote profile row yet (a fresh
 * account that hasn't synced anything up).
 */
export async function loadProfileRemote(
  userId: string
): Promise<PlayerProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const [profileRes, eventsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('weakness_events')
      .select('*')
      .eq('user_id', userId)
      .order('ts', { ascending: true }),
  ]);

  if (profileRes.error) {
    console.warn('[remoteProfileStore] fetch profile failed', profileRes.error.message);
  }
  if (eventsRes.error) {
    console.warn('[remoteProfileStore] fetch events failed', eventsRes.error.message);
  }

  const row = profileRes.data as ProfileRow | null;
  const rawEvents = (eventsRes.data as WeaknessEventRow[] | null) ?? [];
  const weaknessEvents = rawEvents.map(rowToEvent);

  if (!row && weaknessEvents.length === 0) {
    return null;
  }

  const base: PlayerProfile = {
    totalGames: row?.total_games ?? 0,
    totalMoves: row?.total_moves ?? 0,
    weaknessEvents,
    motifCounts: {},
    phaseCpLoss: { opening: 0, middlegame: 0, endgame: 0 },
    openingWeaknesses: {},
    acplHistory: Array.isArray(row?.acpl_history)
      ? (row!.acpl_history as PlayerProfile['acplHistory'])
      : [],
    journeyState: isValidJourneyState(row?.journey_state)
      ? (row!.journey_state as PlayerProfile['journeyState'])
      : {
          calibrationGamesPlayed: 0,
          calibrated: false,
          currentLevel: 'newcomer',
          levelProgress: 0,
          rollingRating: 0,
          gamesAtCurrentLevel: 0,
          reviewCreditsToday: 0,
          reviewCreditDate: new Date().toISOString().slice(0, 10),
          promotionHistory: [],
          lastPromotionDismissed: true,
        },
    createdAt: row?.created_at ? Date.parse(row.created_at) : Date.now(),
    updatedAt: row?.updated_at ? Date.parse(row.updated_at) : Date.now(),
  };

  // Re-derive motif/phase aggregates from the event log so the
  // decayed counts are fresh. Do NOT trust the server-cached copies
  // — they are only a fast path for dashboards that skip the log.
  return recomputeAggregates(base);
}
