/**
 * Daily-streak and weekly-goal logic — pure functions over StreaksState.
 *
 * Streaks track consecutive days of activity (game or review).
 * Weekly goals track games played and mistakes reviewed per week
 * (Monday-to-Sunday cadence).
 *
 * All functions are side-effect-free; the profile store is
 * responsible for persisting the returned state.
 */

import type { StreaksState } from '../profile/types';

/* ─── Defaults ───────────────────────────────────────────────────── */

const DEFAULT_WEEKLY_GAME_TARGET = 5;
const DEFAULT_WEEKLY_REVIEW_TARGET = 10;

/* ─── Helpers ────────────────────────────────────────────────────── */

/** ISO date string (YYYY-MM-DD) for a given timestamp. */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Return the ISO date of the Monday that starts the week containing
 * the given timestamp.
 */
function mondayOfWeek(ms: number): string {
  const d = new Date(ms);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return toIsoDate(d.getTime());
}

/** Return the ISO date of the day before `isoDate`. */
function yesterday(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return toIsoDate(d.getTime());
}

/* ─── Factory ────────────────────────────────────────────────────── */

/** Create a fresh StreaksState (no activity yet). */
export function createEmptyStreaksState(now: number = Date.now()): StreaksState {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: '',
    weekStartDate: mondayOfWeek(now),
    weeklyGamesPlayed: 0,
    weeklyReviewsDone: 0,
    weeklyGameTarget: DEFAULT_WEEKLY_GAME_TARGET,
    weeklyReviewTarget: DEFAULT_WEEKLY_REVIEW_TARGET,
  };
}

/* ─── Core Streak Logic ──────────────────────────────────────────── */

/**
 * Update the daily streak based on new activity.
 *
 * - Same day as last activity → no change.
 * - Consecutive day (yesterday) → increment streak.
 * - Gap of 2+ days → reset streak to 1.
 * - First activity ever (lastActiveDate empty) → start at 1.
 *
 * Returns a new StreaksState with updated streak fields and
 * `lastActiveDate` set to today.
 */
function updateStreak(state: StreaksState, now: number): StreaksState {
  const today = toIsoDate(now);

  // Already counted today — no change.
  if (state.lastActiveDate === today) return state;

  let next = { ...state, lastActiveDate: today };

  if (state.lastActiveDate === '' || state.lastActiveDate !== yesterday(today)) {
    // First activity ever, or gap of 2+ days → start fresh.
    next.currentStreak = 1;
  } else {
    // Consecutive day.
    next.currentStreak = state.currentStreak + 1;
  }

  next.longestStreak = Math.max(next.longestStreak, next.currentStreak);
  return next;
}

/**
 * Reset weekly counters if the current week (Monday) differs from
 * the stored `weekStartDate`.
 */
function resetWeekIfNeeded(state: StreaksState, now: number): StreaksState {
  const currentMonday = mondayOfWeek(now);
  if (state.weekStartDate === currentMonday) return state;

  return {
    ...state,
    weekStartDate: currentMonday,
    weeklyGamesPlayed: 0,
    weeklyReviewsDone: 0,
  };
}

/* ─── Public API ─────────────────────────────────────────────────── */

/**
 * Process a completed game: update daily streak and increment
 * weekly game count.
 */
export function processGameForStreaks(
  state: StreaksState,
  now: number = Date.now(),
): StreaksState {
  let next = resetWeekIfNeeded(state, now);
  next = updateStreak(next, now);
  return { ...next, weeklyGamesPlayed: next.weeklyGamesPlayed + 1 };
}

/**
 * Process a mistake review: update daily streak and increment
 * weekly review count.
 */
export function processReviewForStreaks(
  state: StreaksState,
  now: number = Date.now(),
): StreaksState {
  let next = resetWeekIfNeeded(state, now);
  next = updateStreak(next, now);
  return { ...next, weeklyReviewsDone: next.weeklyReviewsDone + 1 };
}

/**
 * Check whether the previous streak was broken (gap of 2+ days
 * since last activity). Useful for analytics — call *before*
 * `processGameForStreaks` / `processReviewForStreaks` to detect
 * the break.
 */
export function wasStreakBroken(state: StreaksState, now: number = Date.now()): boolean {
  if (state.lastActiveDate === '' || state.currentStreak === 0) return false;
  const today = toIsoDate(now);
  return state.lastActiveDate !== today && state.lastActiveDate !== yesterday(today);
}
