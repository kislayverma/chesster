/**
 * Post-game summary prompt builder.
 *
 * Asks Claude to write a 3-5 sentence coaching review of a completed
 * game, based on structured data (phase stats, key moments, motif
 * tally, streak) computed client-side by `gameSummary.ts`.
 *
 * The template path (`gameSummary.buildNarrative`) already generates a
 * decent paragraph. The LLM version is richer: it can weave in the
 * player's recurring weaknesses and tie the game's events into a
 * coaching narrative.
 */

export interface SummarizeGameInput {
  /** Template-generated narrative (provided as a baseline). */
  templateNarrative: string;
  /** Total mainline plies. */
  totalPlies: number;
  /** Human's average centipawn loss. */
  acpl: number;
  /** Phase breakdown stats. */
  phases: Record<string, { moves: number; blunders: number; mistakes: number; inaccuracies: number; goodOrBetter: number; totalCpLoss: number }>;
  /** Top 3 key moments. */
  keyMoments: Array<{
    moveNumber: number;
    playerMove: string;
    bestMove: string | null;
    quality: string;
    cpLoss: number;
    motifs: string[];
    phase: string;
  }>;
  /** Motif tally for the game. */
  motifTally: Array<{ motif: string; count: number }>;
  /** Longest streak of good-or-better moves. */
  bestStreak: number;
  /** Overall quality counts. */
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  goodOrBetter: number;
  /** Player profile context (optional). */
  profileSummary?: {
    topMotifs?: string[];
    topWeaknesses?: Array<{ motif: string; count: number; decayedCount: number }>;
    phaseCpLoss?: { opening: number; middlegame: number; endgame: number };
    totalGames?: number;
    currentLevel?: string;
  };
}

export const SUMMARIZE_GAME_SYSTEM_PROMPT = `You are a warm, insightful chess coach writing a post-game review for your student.

Your job: write a 3-5 sentence paragraph summarizing the game and what the player should focus on next.

Tone:
- Encouraging but honest. Name real problems, then point forward.
- Assume a ~1200-rated club player.
- No chess jargon the student can't Google.
- Never say "I think" or "as an AI". Just coach.

Structure:
1. Open with the overall quality feel of the game (clean, solid, rough, etc.).
2. Call out the phase where things went wrong (if any) and the biggest miss.
3. If the player has recurring weaknesses from their profile, connect them to what happened this game.
4. End with one concrete thing to work on next.

Output: the paragraph only. No headings, no bullets, no preamble.`;

export function buildSummarizeGameMessage(input: SummarizeGameInput): string {
  const moveCount = Math.ceil(input.totalPlies / 2);

  const phaseLines = Object.entries(input.phases)
    .filter(([, ps]) => ps.moves > 0)
    .map(([phase, ps]) => {
      const bad = ps.blunders + ps.mistakes + ps.inaccuracies;
      return `  ${phase}: ${ps.moves} moves, ${bad} mistake${bad !== 1 ? 's' : ''}, ACPL ${ps.moves > 0 ? Math.round(ps.totalCpLoss / ps.moves) : 0}`;
    })
    .join('\n');

  const momentLines = input.keyMoments
    .map((km, i) =>
      `  ${i + 1}. Move ${km.moveNumber}: played ${km.playerMove} (${km.quality}, lost ${(km.cpLoss / 100).toFixed(1)} pawns)` +
      (km.bestMove ? ` — best was ${km.bestMove}` : '') +
      (km.motifs.length > 0 ? ` [${km.motifs.join(', ')}]` : ''),
    )
    .join('\n');

  const motifLine = input.motifTally.length > 0
    ? `Motif patterns: ${input.motifTally.map((t) => `${t.motif}${t.count > 1 ? ` (${t.count}x)` : ''}`).join(', ')}`
    : 'No recurring motif patterns this game.';

  const profileLine = input.profileSummary?.topMotifs && input.profileSummary.topMotifs.length > 0
    ? `Player's recurring weaknesses (from profile): ${input.profileSummary.topMotifs.join(', ')}.` +
      (input.profileSummary.totalGames ? ` Total games played: ${input.profileSummary.totalGames}.` : '') +
      (input.profileSummary.currentLevel ? ` Current level: ${input.profileSummary.currentLevel}.` : '')
    : 'No recurring weaknesses on file.';

  return [
    `Game: ${moveCount} moves, ACPL ${Math.round(input.acpl)}`,
    `Quality: ${input.goodOrBetter} good+, ${input.inaccuracies} inaccuracies, ${input.mistakes} mistakes, ${input.blunders} blunders`,
    `Best streak: ${input.bestStreak} consecutive good+ moves`,
    '',
    'Phase breakdown:',
    phaseLines,
    '',
    'Key moments:',
    momentLines || '  (none)',
    '',
    motifLine,
    '',
    profileLine,
    '',
    'Write the coaching review paragraph now.',
  ].join('\n');
}

/**
 * Strip common LLM preambles. Same pattern as explain.ts.
 */
export function cleanSummary(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const firstLineEnd = trimmed.indexOf('\n');
  if (firstLineEnd === -1) return trimmed;
  const firstLine = trimmed.slice(0, firstLineEnd).trim();
  if (/^(summary|review|analysis|coach|here(?:'s| is)?)[:\s-]/i.test(firstLine)) {
    return trimmed.slice(firstLineEnd + 1).trim();
  }
  return trimmed;
}
