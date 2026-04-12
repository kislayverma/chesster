/**
 * Phase 6 remote practice-card store.
 *
 * Thin adapter over the `practice_cards` table on Supabase. Follows
 * the same pattern as `remoteGameStore` / `remoteProfileStore`:
 *
 *   • Row converters translate between the camelCase local
 *     `PracticeCard` and the snake_case DB schema.
 *   • Every call returns a boolean (save) or a typed array (load).
 *   • Errors are swallowed and logged — remote sync is best-effort;
 *     the local IndexedDB copy is the source of truth.
 *
 * The Supabase table + RLS policies were already created in Phase 9
 * (`supabase/schema.sql` → `practice_cards`).
 */

import { getSupabase } from './supabaseClient';
import type { PracticeCard } from '../srs/types';

interface CardRow {
  id: string;
  user_id: string;
  event_id: string;
  fen: string;
  best_move: string;
  ease_factor: number;
  interval_days: number;
  due_at: string;
  lapses: number;
  created_at: string;
}

function cardToRow(card: PracticeCard, userId: string): CardRow {
  return {
    id: card.id,
    user_id: userId,
    event_id: card.eventId,
    fen: card.fen,
    best_move: card.bestMove,
    ease_factor: card.easeFactor,
    interval_days: card.intervalDays,
    due_at: new Date(card.dueAt).toISOString(),
    lapses: card.lapses,
    created_at: new Date(card.createdAt).toISOString(),
  };
}

function rowToCard(row: CardRow): PracticeCard {
  return {
    id: row.id,
    eventId: row.event_id,
    fen: row.fen,
    bestMove: row.best_move,
    // motifs aren't stored in the DB (derivable from the event) —
    // we fill them as [] here; the caller can backfill from the
    // local profile's weakness events if desired.
    motifs: [],
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    dueAt: Date.parse(row.due_at),
    lapses: row.lapses,
    createdAt: Date.parse(row.created_at),
  };
}

/**
 * Upsert a single card. Returns true on success.
 */
export async function saveCardRemote(
  userId: string,
  card: PracticeCard,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from('practice_cards')
    .upsert(cardToRow(card, userId), { onConflict: 'id' });
  if (error) {
    console.warn('[remotePracticeStore] saveCard failed', error.message);
    return false;
  }
  return true;
}

/**
 * Bulk-download all practice cards for this user.
 * Called once on sign-in by the sync orchestrator.
 */
export async function loadAllCardsRemote(
  userId: string,
): Promise<PracticeCard[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('practice_cards')
    .select('*')
    .eq('user_id', userId)
    .order('due_at', { ascending: true });
  if (error || !data) {
    if (error)
      console.warn('[remotePracticeStore] loadAll failed', error.message);
    return [];
  }
  return (data as CardRow[]).map(rowToCard);
}
