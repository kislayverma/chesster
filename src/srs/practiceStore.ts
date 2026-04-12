/**
 * Phase 6 practice-card store.
 *
 * Zustand slice that owns the local `PracticeCard[]`. Cards are
 * persisted to IndexedDB via localforage under a single key; on
 * startup the store hydrates from disk, and every mutation auto-saves
 * (debounced, coalescing rapid bursts).
 *
 * New cards are auto-generated from `WeaknessEvent`s (see
 * `gameStore.ts` Phase 6 hook). The `addCard` action deduplicates on
 * `eventId` so replaying the same event is safe.
 *
 * Remote sync follows the same fire-and-forget pattern as the profile
 * and game stores: after each local save we push the changed card to
 * Supabase via `pushCardRemote` in `syncOrchestrator`. This import
 * is deferred to avoid a circular dependency at module load time.
 */

import localforage from 'localforage';
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { PracticeCard } from './types';
import type { WeaknessEvent } from '../profile/types';
import {
  reviewCard as applyReview,
  getDueCards as filterDue,
} from './scheduler';

const STORAGE_KEY = 'chesster:practice:v1';
const SAVE_DEBOUNCE_MS = 500;

interface PracticeStore {
  cards: PracticeCard[];
  hydrated: boolean;

  /** Load on-disk cards into memory. Called once at app boot. */
  hydrate: () => Promise<void>;

  /**
   * Create a new card from a weakness event. Deduplicates on
   * `event.id` so re-processing the same event is harmless.
   */
  addCard: (event: WeaknessEvent) => void;

  /** Apply an SM-2 review (correct / incorrect) to a card by id. */
  reviewCard: (id: string, correct: boolean) => void;

  /** Snapshot of cards currently due, sorted oldest-first. */
  getDueCards: (limit?: number) => PracticeCard[];

  /** Number of cards currently due. */
  dueCount: () => number;

  /**
   * Replace the full card set (used by the sync orchestrator after
   * pulling remote cards on sign-in).
   */
  replaceCards: (cards: PracticeCard[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveCards(cards: PracticeCard[]): Promise<void> {
  try {
    await localforage.setItem(STORAGE_KEY, cards);
  } catch (err) {
    console.warn('[practiceStore] persist failed', err);
  }
}

/**
 * Lazily import pushCardRemote to break the module-load cycle
 * (practiceStore ↔ syncOrchestrator). The function is only needed
 * at save time, never at import time.
 */
async function pushRemote(card: PracticeCard): Promise<void> {
  try {
    const { pushCardRemote } = await import('../sync/syncOrchestrator');
    pushCardRemote(card);
  } catch {
    // sync module unavailable — local-only mode, nothing to push.
  }
}

function scheduleSave(cards: PracticeCard[], changedCard?: PracticeCard): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveCards(cards);
    if (changedCard) void pushRemote(changedCard);
  }, SAVE_DEBOUNCE_MS);
}

export const usePracticeStore = create<PracticeStore>((set, get) => ({
  cards: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await localforage.getItem<PracticeCard[]>(STORAGE_KEY);
      if (Array.isArray(stored)) {
        set({ cards: stored, hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch (err) {
      console.warn('[practiceStore] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  addCard: (event) => {
    const { cards } = get();
    if (cards.some((c) => c.eventId === event.id)) return;

    const card: PracticeCard = {
      id: uuid(),
      eventId: event.id,
      fen: event.fen,
      bestMove: event.bestMove,
      motifs: [...event.motifs],
      easeFactor: 2.5,
      intervalDays: 0,
      dueAt: Date.now(),
      lapses: 0,
      createdAt: Date.now(),
    };

    const next = [...cards, card];
    set({ cards: next });
    scheduleSave(next, card);
  },

  reviewCard: (id, correct) => {
    const { cards } = get();
    const idx = cards.findIndex((c) => c.id === id);
    if (idx === -1) return;

    const updated = applyReview(cards[idx], correct);
    const next = [...cards];
    next[idx] = updated;
    set({ cards: next });
    scheduleSave(next, updated);
  },

  getDueCards: (limit = 20) => filterDue(get().cards, limit),

  dueCount: () => {
    const now = Date.now();
    return get().cards.filter((c) => c.dueAt <= now).length;
  },

  replaceCards: (cards) => {
    set({ cards, hydrated: true });
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void saveCards(cards);
  },
}));
