/**
 * Profile page "Your Story" narrative prompt builder.
 *
 * Asks Claude to write a 2-4 sentence personal coaching journal entry
 * from the structured `NarrativeData` computed client-side by
 * `playerNarrative.ts`.
 *
 * The template path generates a decent paragraph from fill-in
 * sentences. The LLM version reads like a personal coach writing a
 * brief journal entry — warmer, more connective, and able to tie
 * disparate stats into a story.
 */

export interface PlayerNarrativeInput {
  /** Template-generated narrative (baseline). */
  templateNarrative: string;
  /** Structured data from computePlayerNarrative(). */
  data: {
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
  };
}

export const PLAYER_NARRATIVE_SYSTEM_PROMPT = `You are a warm, personal chess coach writing a brief journal entry about your student's progress.

Your job: write a 2-4 sentence paragraph that reads like a coaching journal entry — personal, encouraging, and forward-looking.

Tone:
- Warm and personal, like a mentor who knows this student well.
- Celebrate real progress (promotions, retired weaknesses) without being sycophantic.
- Name current challenges honestly but constructively.
- No chess jargon the student can't Google.
- Never say "I think" or "as an AI". Write as their coach.
- Use "you" — address the student directly.

Output: the paragraph only. No headings, no bullets, no preamble.`;

export function buildPlayerNarrativeMessage(input: PlayerNarrativeInput): string {
  const d = input.data;
  const nameStr = d.displayName ? ` (goes by "${d.displayName}")` : '';

  const lines = [
    `Player${nameStr}: ${d.totalGames} games played.`,
    `Current level: ${d.currentLevelName} (rolling rating: ${d.rollingRating}).`,
    `Games at current level: ${d.gamesAtCurrentLevel}.`,
    `Promotions: ${d.promotionCount}.`,
  ];

  if (d.retiredWeaknesses.length > 0) {
    lines.push(`Conquered weaknesses: ${d.retiredWeaknesses.join(', ')}.`);
  }
  if (d.topWeaknesses.length > 0) {
    lines.push(`Current focus areas: ${d.topWeaknesses.join(', ')}.`);
  }
  if (d.weakestPhase) {
    lines.push(`Weakest phase: ${d.weakestPhase}.`);
  }
  if (d.strongestPhase) {
    lines.push(`Strongest phase: ${d.strongestPhase}.`);
  }
  if (d.pointsToNext != null && d.pointsToNext > 0) {
    lines.push(`About ${d.pointsToNext} rating points to next level.`);
  }

  lines.push('');
  lines.push(`Template version (for reference, write something better): "${input.templateNarrative}"`);
  lines.push('');
  lines.push('Write the coaching journal entry now.');

  return lines.join('\n');
}

/**
 * Strip common LLM preambles.
 */
export function cleanNarrative(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const firstLineEnd = trimmed.indexOf('\n');
  if (firstLineEnd === -1) return trimmed;
  const firstLine = trimmed.slice(0, firstLineEnd).trim();
  if (/^(narrative|story|journal|entry|coach|here(?:'s| is)?)[:\s-]/i.test(firstLine)) {
    return trimmed.slice(firstLineEnd + 1).trim();
  }
  return trimmed;
}
