/**
 * Player narrative — "Your Story" section for the profile page.
 *
 * Generates a 2-4 sentence paragraph from existing profile data that
 * reads like a personal coaching journal entry. Entirely deterministic
 * (no LLM), using template sentences with dynamic data fill-in.
 *
 * When an LLM API key is available, the caller can replace this with
 * an LLM-authored version via `/api/player-narrative`.
 */

import type { PlayerProfile } from './types';
import { getTopWeaknesses, getRetiredWeaknesses } from './weaknessSelector';
import { getLevelDef, nextLevel } from '../lib/rating';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';

export interface PlayerNarrative {
  /** The full narrative paragraph. */
  text: string;
  /** Structured data for potential LLM enrichment. */
  data: NarrativeData;
}

export interface NarrativeData {
  displayName: string | undefined;
  totalGames: number;
  currentLevel: string;
  currentLevelName: string;
  rollingRating: number;
  promotionCount: number;
  retiredWeaknesses: string[];
  topWeaknesses: string[];
  weakestPhase: string | null;
  strongestPhase: string | null;
  pointsToNext: number | null;
  gamesAtCurrentLevel: number;
}

function motifLabel(id: string): string {
  return MOTIF_LABELS[id as MotifId] ?? id.replace(/_/g, ' ');
}

function phaseName(phase: string): string {
  switch (phase) {
    case 'opening': return 'opening';
    case 'middlegame': return 'middlegame';
    case 'endgame': return 'endgame';
    default: return phase;
  }
}

export function computePlayerNarrative(profile: PlayerProfile): PlayerNarrative {
  const { totalGames, phaseCpLoss, journeyState } = profile;
  const journey = journeyState;
  const displayName = journey.displayName;

  const currentDef = getLevelDef(journey.currentLevel);
  const next = nextLevel(journey.currentLevel);
  const rollingRating = journey.rollingRating;

  // Retired weaknesses
  const retired = getRetiredWeaknesses(profile);
  const retiredLabels = retired.map((w) => motifLabel(w.motif));

  // Top active weaknesses
  const topWeak = getTopWeaknesses(profile, 3);
  const topWeakLabels = topWeak.map((w) => motifLabel(w.motif));

  // Phase analysis
  const phaseEntries = [
    { phase: 'opening', acpl: phaseCpLoss.opening },
    { phase: 'middlegame', acpl: phaseCpLoss.middlegame },
    { phase: 'endgame', acpl: phaseCpLoss.endgame },
  ].filter((p) => p.acpl > 0);

  let weakestPhase: string | null = null;
  let strongestPhase: string | null = null;
  if (phaseEntries.length >= 2) {
    const sorted = [...phaseEntries].sort((a, b) => a.acpl - b.acpl);
    strongestPhase = sorted[0].phase;
    weakestPhase = sorted[sorted.length - 1].phase;
    // Only report if there's a meaningful gap
    if (sorted[sorted.length - 1].acpl - sorted[0].acpl < 10) {
      weakestPhase = null;
      strongestPhase = null;
    }
  }

  // Points to next level
  const pointsToNext = next ? Math.max(0, next.floor - rollingRating) : null;

  // Promotion count
  const promotionCount = journey.promotionHistory.length;

  const data: NarrativeData = {
    displayName,
    totalGames,
    currentLevel: journey.currentLevel,
    currentLevelName: currentDef.name,
    rollingRating,
    promotionCount,
    retiredWeaknesses: retiredLabels,
    topWeaknesses: topWeakLabels,
    weakestPhase,
    strongestPhase,
    pointsToNext,
    gamesAtCurrentLevel: journey.gamesAtCurrentLevel,
  };

  const parts: string[] = [];

  // 1. Opening — games played + current level
  const nameStr = displayName ? ` as ${displayName}` : '';
  if (totalGames <= 3) {
    parts.push(`You've played ${totalGames} game${totalGames !== 1 ? 's' : ''}${nameStr} — you're just getting started.`);
  } else {
    parts.push(`You've played ${totalGames} games${nameStr}.`);
  }

  // 2. Progression story
  if (promotionCount > 0) {
    const levelNames = journey.promotionHistory.map(
      (p) => getLevelDef(p.level).name
    );
    if (promotionCount === 1) {
      parts.push(`You promoted to ${levelNames[0]} and are still climbing.`);
    } else {
      parts.push(`You've promoted ${promotionCount} times, reaching ${currentDef.name}.`);
    }
  } else if (totalGames >= 5) {
    parts.push(`You're currently at the ${currentDef.name} level.`);
  }

  // 3. Retired weaknesses (positive reinforcement)
  if (retiredLabels.length === 1) {
    parts.push(`You've conquered ${retiredLabels[0].toLowerCase()} — that's real progress.`);
  } else if (retiredLabels.length > 1) {
    parts.push(`You've retired ${retiredLabels.length} weaknesses along the way — nice work.`);
  }

  // 4. Current challenge — weakest phase or top weakness
  if (weakestPhase && topWeakLabels.length > 0) {
    parts.push(
      `Your ${phaseName(weakestPhase)} needs the most attention right now — ` +
      `focus on ${topWeakLabels[0].toLowerCase()} to keep improving.`
    );
  } else if (topWeakLabels.length > 0) {
    parts.push(
      `Your main area to work on: ${topWeakLabels[0].toLowerCase()}.`
    );
  } else if (weakestPhase) {
    parts.push(
      `Your ${phaseName(weakestPhase)} is your weakest phase — that's where to focus next.`
    );
  }

  // 5. Distance to next level
  if (pointsToNext != null && pointsToNext > 0 && next) {
    parts.push(`About ${pointsToNext} rating points to ${next.name}.`);
  }

  return { text: parts.join(' '), data };
}
