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
import { createEmptyJourneyState } from './profileAggregates';
import type { PlayerProfile, WeaknessEvent } from './types';
import type { ProfileSummary } from '../coach/types';
import { pushProfileRemote } from '../sync/syncOrchestrator';
import { processMistakeReview } from '../lib/journey';
import { createEmptyStreaksState, processReviewForStreaks, wasStreakBroken } from '../lib/streaks';
import { skillLevelForLevel } from '../lib/rating';
import { useGameStore } from '../game/gameStore';
import { trackEvent } from '../lib/analytics';

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

  /** Dismiss the latest promotion banner. */
  dismissPromotion: () => void;

  /** Credit a mistake review for journey progress. */
  recordMistakeReview: () => void;

  /** Set the player's display name (from onboarding). */
  setDisplayName: (name: string) => void;

  /** Update weekly game and review targets. */
  setWeeklyTargets: (gameTarget: number, reviewTarget: number) => void;

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
        // Backfill journeyState for profiles created before the journey system.
        if (!stored.journeyState) {
          stored.journeyState = createEmptyJourneyState();
        }
        // Backfill streaksState for profiles created before the streaks system.
        if (!stored.streaksState) {
          stored.streaksState = createEmptyStreaksState();
        }
        // Recompute decayed counts so they reflect "now", not last save.
        const refreshed = recomputeAggregates(stored);
        set({ profile: refreshed, hydrated: true });
        // Sync Stockfish difficulty to the stored journey level.
        if (refreshed.journeyState) {
          useGameStore.getState().setSkillLevel(
            skillLevelForLevel(refreshed.journeyState.currentLevel),
          );
        }
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
    // If the local journey state is more advanced (more games played
    // at current level, higher level, etc.), keep it. This prevents a
    // stale remote pull from wiping local progress during the debounce
    // window after a game finishes or when the server has an empty
    // '{}' journey_state.
    const local = get().profile.journeyState;
    const remote = next.journeyState;
    if (local) {
      const localGames = local.gamesAtCurrentLevel ?? 0;
      const remoteGames = remote?.gamesAtCurrentLevel ?? 0;
      const localMoreAdvanced = localGames > remoteGames;
      if (localMoreAdvanced) {
        next = { ...next, journeyState: local };
      }
    }
    // Keep local streaks if they are more recent than remote.
    const localStreaks = get().profile.streaksState;
    const remoteStreaks = next.streaksState;
    if (localStreaks && (!remoteStreaks || localStreaks.lastActiveDate > (remoteStreaks.lastActiveDate ?? ''))) {
      next = { ...next, streaksState: localStreaks };
    }
    // Backfill streaksState if absent on remote profile.
    if (!next.streaksState) {
      next = { ...next, streaksState: createEmptyStreaksState() };
    }
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
    const prev = get().profile;

    // Detect streak break before processing (streaks update inside recordGameFinished).
    const streakBroken = wasStreakBroken(
      prev.streaksState ?? createEmptyStreaksState(),
    );
    if (streakBroken) {
      trackEvent('streak_broken', {
        previousStreak: prev.streaksState?.currentStreak ?? 0,
      });
    }

    const next = recordGameFinished(prev, acpl);
    set({ profile: next });

    // Streak analytics.
    if (next.streaksState.currentStreak > (prev.streaksState?.currentStreak ?? 0)) {
      trackEvent('streak_extended', { days: next.streaksState.currentStreak });
    }
    // Weekly goal completion.
    const gs = next.streaksState;
    if (gs.weeklyGamesPlayed >= gs.weeklyGameTarget &&
        (prev.streaksState?.weeklyGamesPlayed ?? 0) < gs.weeklyGameTarget) {
      trackEvent('weekly_goal_completed', { type: 'games' });
    }

    // If the player was promoted, adjust Stockfish to the new level.
    const prevLevel = prev.journeyState?.currentLevel;
    const nextLevel = next.journeyState?.currentLevel;
    if (nextLevel && nextLevel !== prevLevel) {
      trackEvent('level_promoted', {
        newLevel: nextLevel,
        oldLevel: prevLevel ?? 'none',
        gamesPlayed: next.totalGames,
      });
      useGameStore.getState().setSkillLevel(
        skillLevelForLevel(nextLevel),
      );
    }

    // Flush immediately (no debounce) so the journey state reaches
    // IndexedDB + Supabase before any remote hydration can race.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void saveProfile(next);
    pushProfileRemote(next);
  },

  dismissPromotion: () => {
    const profile = get().profile;
    const journeyState = profile.journeyState ?? createEmptyJourneyState();
    const next: PlayerProfile = {
      ...profile,
      journeyState: { ...journeyState, lastPromotionDismissed: true },
    };
    set({ profile: next });
    scheduleSave(next);
  },

  recordMistakeReview: () => {
    const profile = get().profile;
    const now = Date.now();
    const journeyState = profile.journeyState ?? createEmptyJourneyState();
    const updated = processMistakeReview(journeyState, now);
    const updatedStreaks = processReviewForStreaks(
      profile.streaksState ?? createEmptyStreaksState(now),
      now,
    );
    const next: PlayerProfile = {
      ...profile,
      journeyState: updated,
      streaksState: updatedStreaks,
      updatedAt: now,
    };
    set({ profile: next });

    // Weekly review goal completion.
    if (updatedStreaks.weeklyReviewsDone >= updatedStreaks.weeklyReviewTarget &&
        (profile.streaksState?.weeklyReviewsDone ?? 0) < updatedStreaks.weeklyReviewTarget) {
      trackEvent('weekly_goal_completed', { type: 'reviews' });
    }

    scheduleSave(next);
  },

  setDisplayName: (name) => {
    const profile = get().profile;
    const journeyState = profile.journeyState ?? createEmptyJourneyState();
    const next: PlayerProfile = {
      ...profile,
      journeyState: { ...journeyState, displayName: name },
      updatedAt: Date.now(),
    };
    set({ profile: next });
    void saveProfile(next);
    pushProfileRemote(next);
  },

  setWeeklyTargets: (gameTarget, reviewTarget) => {
    const profile = get().profile;
    const streaksState = profile.streaksState ?? createEmptyStreaksState();
    const next: PlayerProfile = {
      ...profile,
      streaksState: {
        ...streaksState,
        weeklyGameTarget: Math.max(1, gameTarget),
        weeklyReviewTarget: Math.max(1, reviewTarget),
      },
      updatedAt: Date.now(),
    };
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
