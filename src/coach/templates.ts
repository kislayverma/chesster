/**
 * Phase 3 fallback coaching templates.
 *
 * `renderTemplate(req)` returns a short piece of prose describing the
 * player's move. Organization:
 *
 *   • Good-side  (best/excellent/good/book)  → motif-agnostic praise
 *   • Bad-side   (inaccuracy/mistake/blunder) → try a (quality,motif)
 *                                               template first, fall
 *                                               through to a generic
 *                                               cpLoss sentence
 *
 * Total authored snippets: 22 — three praise, one book, three generic
 * bad, and one per (quality × motif) for five motifs = 15. DESIGN.md §15
 * Phase 3 requires "20+ hand-authored snippets".
 *
 * When Phase 7 adds the LLM branch, `coachClient.ts` tries the LLM
 * first and falls through to `renderTemplate` on any failure — so
 * these strings are the floor of the coaching experience, not the
 * ceiling.
 */

import type { MoveQuality } from '../game/moveClassifier';
import type { GamePhase } from '../tagging/phaseDetector';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import { MOTIF_PHRASES } from './motifPhrases';
import type { CoachRequest } from './types';

/** Minimum decayed count for the reinforcement suffix to fire. */
const REINFORCEMENT_MIN_COUNT = 3;

/** Format a mover-perspective cpLoss as a human-readable pawn count. */
function pawns(cpLoss: number): string {
  const p = Math.abs(cpLoss) / 100;
  if (p < 0.1) return 'a fraction of a pawn';
  if (p >= 10) return 'an overwhelming amount';
  return `${p.toFixed(1)} pawns`;
}

function phaseHint(phase: GamePhase): string {
  switch (phase) {
    case 'opening':
      return 'in the opening';
    case 'middlegame':
      return 'in the middlegame';
    case 'endgame':
      return 'in the endgame';
  }
}

function bestMoveSuffix(req: CoachRequest): string {
  return req.bestMove ? ` The engine preferred ${req.bestMove}.` : '';
}

type TemplateFn = (req: CoachRequest) => string;

// ---------- Good side ----------

const BEST: TemplateFn = (req) =>
  `Best move — ${req.playerMove}. The engine agrees this is the top choice.`;

const EXCELLENT: TemplateFn = (req) =>
  `Excellent. ${req.playerMove} is within a fraction of a pawn of the engine's pick.`;

const GOOD: TemplateFn = (req) =>
  `Solid. ${req.playerMove} keeps most of your evaluation intact.`;

const BOOK: TemplateFn = (_req) => 'Book move — theory territory.';

// ---------- Bad side · motif-specific ----------

const BAD_TEMPLATES: Partial<Record<`${MoveQuality}/${MotifId}`, TemplateFn>> = {
  // hanging_piece
  'inaccuracy/hanging_piece': (req) =>
    `A little loose: ${MOTIF_PHRASES.hanging_piece}. About ${pawns(req.cpLoss)} slipped.${bestMoveSuffix(req)}`,
  'mistake/hanging_piece': (req) =>
    `${req.playerMove} leaves a piece hanging — ${MOTIF_PHRASES.hanging_piece}. You dropped about ${pawns(req.cpLoss)}.${bestMoveSuffix(req)}`,
  'blunder/hanging_piece': (req) =>
    `Hanging piece. After ${req.playerMove} the opponent simply captures; that's roughly ${pawns(req.cpLoss)} gone.${bestMoveSuffix(req)}`,

  // missed_capture
  'inaccuracy/missed_capture': (req) =>
    `You could have taken material here — ${MOTIF_PHRASES.missed_capture}.${bestMoveSuffix(req)}`,
  'mistake/missed_capture': (req) =>
    `${MOTIF_PHRASES.missed_capture}. About ${pawns(req.cpLoss)} walked by.${bestMoveSuffix(req)}`,
  'blunder/missed_capture': (req) =>
    `Big miss — a free piece was sitting there. ${bestMoveSuffix(req).trim() || 'The engine saw it.'} Roughly ${pawns(req.cpLoss)} lost.`,

  // missed_fork
  'inaccuracy/missed_fork': (req) =>
    `There was a small tactic available — ${MOTIF_PHRASES.missed_fork}.${bestMoveSuffix(req)}`,
  'mistake/missed_fork': (req) =>
    `You missed a fork. ${MOTIF_PHRASES.missed_fork}. About ${pawns(req.cpLoss)} of evaluation lost.${bestMoveSuffix(req)}`,
  'blunder/missed_fork': (req) =>
    `Tactical miss — ${MOTIF_PHRASES.missed_fork}. Roughly ${pawns(req.cpLoss)} gone.${bestMoveSuffix(req)}`,

  // back_rank_weakness
  'inaccuracy/back_rank_weakness': (_req) =>
    `Watch the back rank — ${MOTIF_PHRASES.back_rank_weakness}. A single pawn move to create luft (h3 / h6) is cheap insurance.`,
  'mistake/back_rank_weakness': (req) =>
    `${MOTIF_PHRASES.back_rank_weakness}. That's about ${pawns(req.cpLoss)} of swing. A pawn move to create luft would have helped.`,
  'blunder/back_rank_weakness': (req) =>
    `Back-rank trouble. ${MOTIF_PHRASES.back_rank_weakness}. Around ${pawns(req.cpLoss)} lost — always scan for back-rank threats before committing to other plans.${bestMoveSuffix(req)}`,

  // missed_mate
  'inaccuracy/missed_mate': (req) =>
    `There was a forced mating sequence here.${bestMoveSuffix(req)} You still have an edge, but the clean finish is gone.`,
  'mistake/missed_mate': (req) =>
    `You gave up a forced mate.${bestMoveSuffix(req)} Always double-check for mating ideas before playing a "good-looking" move.`,
  'blunder/missed_mate': (req) =>
    `Mate missed.${bestMoveSuffix(req)} When you're attacking a weak king, scan checks and forcing moves first.`,
};

// ---------- Bad side · generic fallbacks ----------

const INACCURACY_GENERIC: TemplateFn = (req) =>
  `Slight inaccuracy — about ${pawns(req.cpLoss)} lost ${phaseHint(req.phase)}.${bestMoveSuffix(req)}`;

const MISTAKE_GENERIC: TemplateFn = (req) =>
  `Mistake ${phaseHint(req.phase)} — about ${pawns(req.cpLoss)} lost.${bestMoveSuffix(req)}`;

const BLUNDER_GENERIC: TemplateFn = (req) =>
  `Blunder — roughly ${pawns(req.cpLoss)} gone ${phaseHint(req.phase)}.${bestMoveSuffix(req)}`;

/**
 * Reorder the detected motifs so that ones matching the player's
 * current top weaknesses come first. Ties broken by original order.
 * Pure helper — never mutates the request.
 */
function biasMotifsByProfile(req: CoachRequest): MotifId[] {
  const summary = req.profileSummary;
  if (!summary || summary.topMotifs.length === 0) return req.motifs;
  const priority = new Map<string, number>();
  summary.topMotifs.forEach((m, idx) => priority.set(m, idx));
  return [...req.motifs].sort((a, b) => {
    const pa = priority.has(a) ? (priority.get(a) as number) : Infinity;
    const pb = priority.has(b) ? (priority.get(b) as number) : Infinity;
    return pa - pb;
  });
}

/**
 * If the motif that matched a template is one the player has tripped
 * ≥3 times recently, append a reinforcement nudge. Returns an empty
 * string when nothing to add.
 */
function reinforcementSuffix(
  req: CoachRequest,
  matchedMotif: MotifId
): string {
  const entry = req.profileSummary?.topWeaknesses.find(
    (w) => w.motif === matchedMotif
  );
  if (!entry) return '';
  if (entry.decayedCount < REINFORCEMENT_MIN_COUNT) return '';
  const label = MOTIF_LABELS[matchedMotif] ?? matchedMotif;
  return ` (${label} is a recurring weakness for you — this is a pattern to fix.)`;
}

// ---------- Entry point ----------

export function renderTemplate(req: CoachRequest): string {
  switch (req.quality) {
    case 'book':
      return BOOK(req);
    case 'best':
      return BEST(req);
    case 'excellent':
      return EXCELLENT(req);
    case 'good':
      return GOOD(req);
    default:
      break;
  }

  // Bad side — try each tagged motif in weakness-biased order,
  // then fall through to a phase-aware generic sentence.
  const biasedMotifs = biasMotifsByProfile(req);
  for (const motif of biasedMotifs) {
    const key = `${req.quality}/${motif}` as const;
    const fn = BAD_TEMPLATES[key];
    if (fn) return fn(req) + reinforcementSuffix(req, motif);
  }

  switch (req.quality) {
    case 'inaccuracy':
      return INACCURACY_GENERIC(req);
    case 'mistake':
      return MISTAKE_GENERIC(req);
    case 'blunder':
      return BLUNDER_GENERIC(req);
  }
  return '';
}
