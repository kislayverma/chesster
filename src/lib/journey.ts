/**
 * Journey progression logic — pure functions over profile data.
 *
 * See DESIGN.md §17 for the full spec. Summary:
 *   - 2-game calibration assigns an initial level.
 *   - 6 levels: Newcomer → Learner → Club Player → Competitor →
 *     Advanced Thinker → Expert.
 *   - Multi-source progress: playing games, reviewing mistakes,
 *     reducing weaknesses.
 *   - Promotion requires progress bar at 100% AND rolling Elo ≥
 *     next level floor AND ≥ 5 games at current level.
 *   - No demotion — progress drains but level title never drops.
 */

import type { JourneyState, AcplHistoryEntry } from '../profile/types';
import {
  acplToRating,
  getLevelDef,
  levelForRating,
  nextLevel,
  type LevelDef,
} from './rating';
import type { MotifId } from '../tagging/motifs';

/* ─── Constants ───────────────────────────────────────────────────── */

/** Number of games required for initial calibration. */
export const CALIBRATION_GAMES = 2;

/** Minimum games at a level before promotion is allowed. */
const MIN_GAMES_FOR_PROMOTION = 5;

/** Maximum mistake-review credits per day. */
export const MAX_REVIEW_CREDITS_PER_DAY = 3;

/** Rolling-rating window size (number of most recent games). */
const ROLLING_WINDOW = 10;

/** Focus motifs per level (mapped to MotifId from motifs.ts). */
const LEVEL_FOCUS_MOTIFS: Record<string, MotifId[]> = {
  newcomer:        ['hanging_piece', 'missed_capture'],
  learner:         ['missed_fork', 'missed_pin'],
  clubPlayer:      ['king_safety_drop', 'back_rank_weakness'],
  competitor:      ['missed_skewer', 'overloaded_defender'],
  advancedThinker: ['trade_into_bad_endgame', 'missed_mate'],
  expert:          ['hanging_piece', 'missed_fork', 'missed_pin', 'missed_skewer', 'overloaded_defender', 'king_safety_drop', 'trade_into_bad_endgame', 'missed_capture', 'back_rank_weakness', 'missed_mate'],
};

/* ─── Rolling Rating ──────────────────────────────────────────────── */

/**
 * Compute a weighted average Elo from the most recent `window` games.
 * More recent games are weighted higher (linearly increasing weights).
 */
export function computeRollingRating(
  acplHistory: AcplHistoryEntry[],
  window: number = ROLLING_WINDOW,
): number {
  if (acplHistory.length === 0) return 0;
  const slice = acplHistory.slice(-window);
  let weightSum = 0;
  let ratingSum = 0;
  for (let i = 0; i < slice.length; i++) {
    const weight = i + 1; // 1, 2, 3, ... most recent = highest
    const rating = acplToRating(slice[i].acpl);
    ratingSum += rating * weight;
    weightSum += weight;
  }
  return Math.round(ratingSum / weightSum);
}

/* ─── Calibration ─────────────────────────────────────────────────── */

/**
 * After 2 calibration games, compute the initial level from the
 * weighted average ACPL (game 1 weight=1.0, game 2 weight=1.5).
 */
export function assignInitialLevel(
  acplHistory: AcplHistoryEntry[],
): { level: LevelDef; rating: number } {
  const last2 = acplHistory.slice(-CALIBRATION_GAMES);
  if (last2.length < CALIBRATION_GAMES) {
    return { level: getLevelDef('newcomer'), rating: 0 };
  }
  const weightedAcpl =
    (last2[0].acpl * 1.0 + last2[1].acpl * 1.5) / 2.5;
  const rating = acplToRating(weightedAcpl);
  const level = levelForRating(rating);
  return { level, rating };
}

/**
 * Determine whether the Stockfish skill level should be adjusted
 * after a calibration game. Returns the delta (+3 or -3) or 0.
 */
export function calibrationSkillAdjust(acpl: number): number {
  if (acpl < 50) return 3;   // Player is stronger than mid → harder
  if (acpl > 50) return -3;  // Player is weaker → easier
  return 0;
}

/* ─── Progress Computation ────────────────────────────────────────── */

/**
 * Compute level progress (0-100) based on the player's rolling rating
 * relative to the current level's Elo range.
 *
 * Progress = how far the rolling rating is between the current level's
 * floor and the next level's floor, clamped to 0-100.
 */
export function computeLevelProgress(
  rollingRating: number,
  currentLevelKey: string,
): number {
  const current = getLevelDef(currentLevelKey);
  const next = nextLevel(currentLevelKey);
  if (!next) return 100; // Top level — always full

  const range = next.floor - current.floor;
  if (range <= 0) return 100;

  const position = rollingRating - current.floor;
  const pct = Math.round((position / range) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Progress bonus from playing a game, based on how the game's ACPL
 * compares to the current level's expected range.
 * Returns 5-15.
 */
export function gameProgressBonus(
  gameAcpl: number,
  currentLevelKey: string,
): number {
  const current = getLevelDef(currentLevelKey);
  const next = nextLevel(currentLevelKey);
  if (!next) return 5; // Top level — minimal

  const gameRating = acplToRating(gameAcpl);
  // Playing above the next level floor = max bonus
  if (gameRating >= next.floor) return 15;
  // Playing at current level floor = min bonus
  if (gameRating <= current.floor) return 5;
  // Linear interpolation between 5 and 15
  const range = next.floor - current.floor;
  const position = gameRating - current.floor;
  return Math.round(5 + (position / range) * 10);
}

/**
 * Progress bonus from reviewing a mistake (3-5, random).
 */
export function reviewProgressBonus(): number {
  return 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
}

/** Weakness-reduction bonus (fixed 10%). */
export const WEAKNESS_REDUCTION_BONUS = 10;

/* ─── Promotion Check ─────────────────────────────────────────────── */

/**
 * Check whether the player qualifies for promotion.
 * Returns the next level if promoted, or null.
 */
export function checkPromotion(
  journey: JourneyState,
): LevelDef | null {
  if (!journey.calibrated) return null;

  const next = nextLevel(journey.currentLevel);
  if (!next) return null; // Already at top

  if (journey.gamesAtCurrentLevel < MIN_GAMES_FOR_PROMOTION) return null;
  if (journey.levelProgress < 100) return null;
  if (journey.rollingRating < next.floor) return null;

  return next;
}

/* ─── Journey State Machine ───────────────────────────────────────── */

/**
 * Process a completed game and return updated journey state.
 * Handles calibration, progress, and promotion in one pass.
 */
export function processGameFinished(
  journey: JourneyState,
  acplHistory: AcplHistoryEntry[],
  gameAcpl: number,
  now: number = Date.now(),
): JourneyState {
  let next = { ...journey };

  // ── Calibration phase ──────────────────────────────────────────
  if (!next.calibrated) {
    next.calibrationGamesPlayed += 1;
    if (next.calibrationGamesPlayed >= CALIBRATION_GAMES) {
      const { level, rating } = assignInitialLevel(acplHistory);
      next.calibrated = true;
      next.currentLevel = level.key;
      next.rollingRating = rating;
      next.levelProgress = computeLevelProgress(rating, level.key);
      next.gamesAtCurrentLevel = 0;
      next.lastPromotionDismissed = false; // Show initial level reveal
      next.promotionHistory = [
        ...next.promotionHistory,
        { level: level.key, timestamp: now },
      ];
    }
    return next;
  }

  // ── Post-calibration: update rolling rating ────────────────────
  next.rollingRating = computeRollingRating(acplHistory);
  next.gamesAtCurrentLevel += 1;

  // ── Progress from playing ──────────────────────────────────────
  const bonus = gameProgressBonus(gameAcpl, next.currentLevel);
  next.levelProgress = computeLevelProgress(
    next.rollingRating,
    next.currentLevel,
  );
  // Add the activity bonus on top (capped at 100)
  next.levelProgress = Math.min(
    100,
    next.levelProgress + bonus,
  );

  // ── Promotion check ────────────────────────────────────────────
  const promoted = checkPromotion(next);
  if (promoted) {
    next.currentLevel = promoted.key;
    next.gamesAtCurrentLevel = 0;
    next.levelProgress = computeLevelProgress(
      next.rollingRating,
      promoted.key,
    );
    next.lastPromotionDismissed = false;
    next.promotionHistory = [
      ...next.promotionHistory,
      { level: promoted.key, timestamp: now },
    ];
  }

  return next;
}

/**
 * Credit a mistake review. Returns updated journey state with
 * progress bumped (if under the daily cap).
 */
export function processMistakeReview(
  journey: JourneyState,
  now: number = Date.now(),
): JourneyState {
  if (!journey.calibrated) return journey;

  const today = new Date(now).toISOString().slice(0, 10);
  let next = { ...journey };

  // Reset daily counter if it's a new day
  if (next.reviewCreditDate !== today) {
    next.reviewCreditsToday = 0;
    next.reviewCreditDate = today;
  }

  if (next.reviewCreditsToday >= MAX_REVIEW_CREDITS_PER_DAY) return next;

  next.reviewCreditsToday += 1;
  const bonus = reviewProgressBonus();
  next.levelProgress = Math.min(100, next.levelProgress + bonus);

  // Check promotion after progress bump
  const promoted = checkPromotion(next);
  if (promoted) {
    next.currentLevel = promoted.key;
    next.gamesAtCurrentLevel = 0;
    next.levelProgress = computeLevelProgress(
      next.rollingRating,
      promoted.key,
    );
    next.lastPromotionDismissed = false;
    next.promotionHistory = [
      ...next.promotionHistory,
      { level: promoted.key, timestamp: now },
    ];
  }

  return next;
}

/* ─── Focus Areas ─────────────────────────────────────────────────── */

/** Get the focus motifs for a level. */
export function levelFocusAreas(levelKey: string): MotifId[] {
  return LEVEL_FOCUS_MOTIFS[levelKey] ?? [];
}
