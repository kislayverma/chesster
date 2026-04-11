/**
 * Phase 5 profile store.
 *
 * Zustand slice that owns the local `PlayerProfile`. The profile is
 * persisted to IndexedDB via localforage under a single key; on
 * startup the store hydrates from disk, and every mutation auto-saves
 * (debounced, so rapid event bursts coalesce into one write).
 *
 * Mutating actions are pure-function wrappers around
 * `profileAggregates` helpers — the store never edits the profile
 * in place.
 */

import localforage from 'localforage';
import { create } from 'zustand';
import {
  appendWeaknessEvent,
  createEmptyProfile,
  incrementMoveCount,
  recomputeAggregates,
  recordGameFinished,
} from './profileAggregates';
import { buildProfileSummary } from './weaknessSelector';
import type { PlayerProfile, WeaknessEvent } from './types';
import type { ProfileSummary } from '../coach/types';
import { pushProfileRemote } from '../sync/syncOrchestrator';

const STORAGE_KEY = 'chesster:profile:v1';
const SAVE_DEBOUNCE_MS = 500;

interface ProfileStore {
  profile: PlayerProfile;
  hydrated: boolean;

  /** Load the on-disk profile into memory. Called once at app boot. */
  hydrate: () => Promise<void>;

  /** Reset to an empty profile (local-device wipe). */
  clearProfile: () => void;

  /**
   * Replace the entire profile (used by the sync orchestrator after
   * pulling a remote profile on sign-in). Writes through to IndexedDB
   * synchronously via the debounced saver so a subsequent cold boot
   * sees the hydrated copy.
   */
  replaceProfile: (next: PlayerProfile) => void;

  /** Append a classified-mistake event and refresh aggregates. */
  addWeaknessEvent: (event: WeaknessEvent) => void;

  /** Bump totalMoves (called once per classified player move). */
  incrementMoves: () => void;

  /** Record a finished game: totalGames++ and push an ACPL sample. */
  finishGame: (acpl: number) => void;

  /** Trimmed projection sent to the coach for personalization. */
  getProfileSummary: () => ProfileSummary;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveProfile(profile: PlayerProfile): Promise<void> {
  try {
    await localforage.setItem(STORAGE_KEY, profile);
  } catch (err) {
    console.warn('[profileStore] failed to persist profile', err);
  }
}

function scheduleSave(profile: PlayerProfile): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveProfile(profile);
    // Best-effort dual-write to Supabase. No-op when anonymous.
    pushProfileRemote(profile);
  }, SAVE_DEBOUNCE_MS);
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profile: createEmptyProfile(),
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await localforage.getItem<PlayerProfile>(STORAGE_KEY);
      if (stored && Array.isArray(stored.weaknessEvents)) {
        // Recompute decayed counts so they reflect "now", not last save.
        const refreshed = recomputeAggregates(stored);
        set({ profile: refreshed, hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch (err) {
      console.warn('[profileStore] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  clearProfile: () => {
    const empty = createEmptyProfile();
    set({ profile: empty });
    scheduleSave(empty);
  },

  replaceProfile: (next) => {
    set({ profile: next, hydrated: true });
    // Write straight through to IndexedDB — we JUST pulled this from
    // Supabase, so bouncing it back through `scheduleSave` would
    // trigger a pointless remote round-trip.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void saveProfile(next);
  },

  addWeaknessEvent: (event) => {
    const next = appendWeaknessEvent(get().profile, event);
    set({ profile: next });
    scheduleSave(next);
  },

  incrementMoves: () => {
    const next = incrementMoveCount(get().profile);
    set({ profile: next });
    scheduleSave(next);
  },

  finishGame: (acpl) => {
    const next = recordGameFinished(get().profile, acpl);
    set({ profile: next });
    scheduleSave(next);
  },

  getProfileSummary: () => buildProfileSummary(get().profile),
}));

/**
 * Framework-agnostic accessor for non-React code (e.g. coachClient
 * when it wants to inject the profile summary into a CoachRequest).
 */
export function getCurrentProfileSummary(): ProfileSummary {
  return useProfileStore.getState().getProfileSummary();
}
