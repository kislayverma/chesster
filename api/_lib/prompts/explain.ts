/**
 * Phase 7 coaching prompt builder.
 *
 * Produces the `system` + `user` message pair for `POST /api/explain-move`.
 * The prompt is aggressively compact so the 300-token cap in the route
 * buys us a short, punchy paragraph the player can read at a glance.
 *
 * Contract (mirrors `src/coach/types.ts::CoachRequest`):
 *   • fenBefore, playerMove (SAN), bestMove (SAN), pv (UCI[])
 *   • quality (best | … | blunder), cpLoss (centipawns, mover-perspective)
 *   • motifs (rule + any LLM-tagged; already deduped upstream)
 *   • phase (opening | middlegame | endgame)
 *   • profileSummary.topMotifs — used to bias the tone toward the
 *     player's recurring weaknesses ("you've now hung pieces three
 *     times this week"), if any.
 *
 * The response is plain text, not JSON. The route strips any LLM
 * preamble like "Here is your explanation:" before returning it.
 */

export interface ExplainInput {
  fenBefore: string;
  playerMove: string;
  bestMove: string;
  pv: string[];
  quality: string;
  cpLoss: number;
  motifs: string[];
  phase: string;
  profileSummary?: {
    topMotifs?: string[];
    topWeaknesses?: Array<{ motif: string; count: number; decayedCount: number }>;
    phaseCpLoss?: { opening: number; middlegame: number; endgame: number };
  };
}

export const EXPLAIN_SYSTEM_PROMPT = `You are a concise, encouraging chess coach.

Your job: write ONE short paragraph (≤3 sentences, ≤60 words) explaining why the player's move was not optimal and what they should have played instead.

Tone:
- Direct, friendly, never condescending.
- Assume a ~1200-rated club player.
- No chess jargon the student can't Google: avoid "prophylaxis", "lucena", etc.
- Never say "I think" or "as an AI". Just coach.

Structure:
1. Name the issue concretely (e.g. "That leaves the knight on f6 undefended").
2. Give the better move in plain English (use the provided SAN).
3. If the player has repeated this motif recently, add a one-clause nudge ("this is the third time this week — keep an eye on defenders").

Output: the paragraph only. No headings, no bullets, no prefaces like "Here's your analysis".`;

export function buildExplainUserMessage(input: ExplainInput): string {
  const motifsLine = input.motifs.length > 0
    ? `Detected motifs: ${input.motifs.join(', ')}.`
    : 'No rule-detected motifs.';

  const profileLine = input.profileSummary?.topMotifs && input.profileSummary.topMotifs.length > 0
    ? `Player's recurring weaknesses (most to least recent): ${input.profileSummary.topMotifs.join(', ')}.`
    : 'No recurring weaknesses on file.';

  const pvLine = input.pv.length > 0 ? input.pv.slice(0, 6).join(' ') : '(none)';

  return [
    `Position (FEN): ${input.fenBefore}`,
    `Phase: ${input.phase}`,
    `Player played: ${input.playerMove}`,
    `Engine's best move: ${input.bestMove || '(unknown)'}`,
    `Principal variation after best move: ${pvLine}`,
    `Quality verdict: ${input.quality} (centipawn loss: ${input.cpLoss})`,
    motifsLine,
    profileLine,
    '',
    'Write the coaching paragraph now.',
  ].join('\n');
}

/**
 * Strip common LLM preambles from the response. The model is told not
 * to add them, but belt-and-suspenders: if the first line looks like a
 * header ("Analysis:", "Here:") we drop it.
 */
export function cleanExplanation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const firstLineEnd = trimmed.indexOf('\n');
  if (firstLineEnd === -1) return trimmed;
  const firstLine = trimmed.slice(0, firstLineEnd).trim();
  if (/^(analysis|explanation|coach|here(?:'s| is)?)[:\s-]/i.test(firstLine)) {
    return trimmed.slice(firstLineEnd + 1).trim();
  }
  return trimmed;
}
