/**
 * Phase 6 SM-2 scheduler.
 *
 * Pure functions — no side effects, no store imports. Given a card
 * and a review outcome, returns a new card with updated scheduling
 * fields.
 *
 * SM-2 algorithm (simplified):
 *
 *   Correct answer (quality = 4):
 *     • First successful review  → interval = 1 day
 *     • Second successful review → interval = 6 days
 *     • Subsequent               → interval = prev × EF
 *     • EF' = max(1.3, EF + 0.1 - (5 - q)(0.08 + (5 - q)·0.02))
 *     • dueAt = now + interval (in ms)
 *
 *   Incorrect answer (quality = 1):
 *     • interval = 0 (card is due again immediately next session)
 *     • EF decreases but never below 1.3
 *     • lapses++
 *
 * Reference: https://super-memory.com/english/ol/sm2.htm
 */

import type { PracticeCard } from './types';

const MIN_EASE = 1.3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FIRST_INTERVAL = 1;
const SECOND_INTERVAL = 6;

function newEaseFactor(ef: number, quality: number): number {
  return Math.max(MIN_EASE, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
}

/**
 * Apply a single review to a card and return the updated copy.
 * The original card is not mutated.
 */
export function reviewCard(card: PracticeCard, correct: boolean): PracticeCard {
  const now = Date.now();

  if (correct) {
    const q = 4;
    const ef = newEaseFactor(card.easeFactor, q);

    let interval: number;
    if (card.intervalDays === 0) {
      interval = FIRST_INTERVAL;
    } else if (card.intervalDays <= FIRST_INTERVAL) {
      interval = SECOND_INTERVAL;
    } else {
      interval = Math.round(card.intervalDays * ef * 10) / 10;
    }

    return {
      ...card,
      easeFactor: ef,
      intervalDays: interval,
      dueAt: now + interval * MS_PER_DAY,
    };
  }

  // Incorrect: reset interval, reduce ease, bump lapse counter.
  const q = 1;
  const ef = newEaseFactor(card.easeFactor, q);

  return {
    ...card,
    easeFactor: ef,
    intervalDays: 0,
    dueAt: now, // due immediately (next session or page revisit)
    lapses: card.lapses + 1,
  };
}

/** True when `card.dueAt` is at or before now. */
export function isDue(card: PracticeCard): boolean {
  return card.dueAt <= Date.now();
}

/**
 * Return cards that are currently due, sorted oldest-due-first,
 * capped at `limit`.
 */
export function getDueCards(cards: PracticeCard[], limit = 20): PracticeCard[] {
  const now = Date.now();
  return cards
    .filter((c) => c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit);
}
