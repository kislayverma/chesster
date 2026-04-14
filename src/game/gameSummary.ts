/**
 * Game summary computation.
 *
 * Walks the mainline of a completed game tree and produces a structured
 * summary used by both the template-based and LLM-based post-game
 * review experiences.
 *
 * Every field is deterministically computed from tree data — no LLM
 * calls, no side effects.
 */

import { walkMainline, type GameTree } from './gameTree';
import { detectPhase, type GamePhase } from '../tagging/phaseDetector';
import type { MoveQuality } from './moveClassifier';
import type { MotifId } from '../tagging/motifs';
import { MOTIF_LABELS } from '../tagging/motifs';
import { QUALITY_LABELS } from './moveClassifier';

/* ─── Types ────────────────────────────────────────────────────────── */

export interface PhaseStat {
  moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  goodOrBetter: number;
  totalCpLoss: number;
}

export interface KeyMoment {
  /** Mainline ply index of this node (1-based, matching the review page). */
  ply: number;
  /** Full-move number. */
  moveNumber: number;
  color: 'white' | 'black';
  playerMove: string;
  bestMove: string | null;
  quality: MoveQuality;
  cpLoss: number;
  motifs: MotifId[];
  coachText: string | null;
  coachSource: 'llm' | 'template' | null;
  phase: GamePhase;
}

export interface MotifTally {
  motif: MotifId;
  count: number;
}

export interface GameSummary {
  /** Total mainline plies (excluding root). */
  totalPlies: number;
  /** Human player's ACPL across evaluated mainline moves. */
  acpl: number;

  /** Counts broken down by game phase for the human's moves. */
  phases: Record<GamePhase, PhaseStat>;

  /** Top 3 key moments sorted by cpLoss descending. */
  keyMoments: KeyMoment[];

  /** Motifs that appeared in the human's mistakes, sorted by frequency. */
  motifTally: MotifTally[];

  /** Longest streak of consecutive good-or-better human moves. */
  bestStreak: number;

  /** Overall quality counts (human's moves only). */
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  goodOrBetter: number;

  /** Template-generated narrative paragraph (no LLM needed). */
  narrative: string;
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function emptyPhase(): PhaseStat {
  return { moves: 0, blunders: 0, mistakes: 0, inaccuracies: 0, goodOrBetter: 0, totalCpLoss: 0 };
}

function isBad(q: MoveQuality): boolean {
  return q === 'inaccuracy' || q === 'mistake' || q === 'blunder';
}

function phaseLabel(phase: GamePhase): string {
  switch (phase) {
    case 'opening': return 'opening';
    case 'middlegame': return 'middlegame';
    case 'endgame': return 'endgame';
  }
}

function cpToPawns(cp: number): string {
  const p = Math.abs(cp) / 100;
  if (p < 0.1) return 'a fraction of a pawn';
  return `${p.toFixed(1)} pawns`;
}

/* ─── Main ─────────────────────────────────────────────────────────── */

export function computeGameSummary(
  tree: GameTree,
  humanColor: 'w' | 'b',
): GameSummary {
  const phases: Record<GamePhase, PhaseStat> = {
    opening: emptyPhase(),
    middlegame: emptyPhase(),
    endgame: emptyPhase(),
  };

  const allMoments: KeyMoment[] = [];
  const motifMap = new Map<MotifId, number>();

  let totalCpLoss = 0;
  let humanMoveCount = 0;
  let bestStreak = 0;
  let currentStreak = 0;
  let blunders = 0;
  let mistakeCount = 0;
  let inaccuracies = 0;
  let goodOrBetter = 0;
  let plyIndex = 0;

  for (const node of walkMainline(tree)) {
    if (node.parentId === null) {
      plyIndex = 0;
      continue; // skip root
    }
    plyIndex += 1;

    // Only analyze the human's moves
    if (node.moverColor !== humanColor) continue;

    const quality = node.quality;
    if (!quality || quality === 'book') {
      // Book moves or unclassified — count as neutral
      currentStreak += 1;
      continue;
    }

    humanMoveCount += 1;
    const cpLoss = Math.max(0, node.cpLoss ?? 0);
    totalCpLoss += cpLoss;

    // Detect phase from the parent's FEN (position before the move)
    const parentNode = tree.nodes.get(node.parentId ?? '');
    const phase = parentNode ? detectPhase(parentNode.fen) : 'middlegame';
    const ps = phases[phase];
    ps.moves += 1;
    ps.totalCpLoss += cpLoss;

    if (quality === 'blunder') {
      blunders += 1;
      ps.blunders += 1;
      currentStreak = 0;
    } else if (quality === 'mistake') {
      mistakeCount += 1;
      ps.mistakes += 1;
      currentStreak = 0;
    } else if (quality === 'inaccuracy') {
      inaccuracies += 1;
      ps.inaccuracies += 1;
      currentStreak = 0;
    } else {
      goodOrBetter += 1;
      ps.goodOrBetter += 1;
      currentStreak += 1;
    }
    bestStreak = Math.max(bestStreak, currentStreak);

    // Record as potential key moment if it's a bad move
    if (isBad(quality)) {
      const bestMoveUci = node.bestMoveBeforeUci;
      allMoments.push({
        ply: plyIndex,
        moveNumber: Math.ceil(plyIndex / 2),
        color: humanColor === 'w' ? 'white' : 'black',
        playerMove: node.move,
        bestMove: bestMoveUci ?? null,
        quality,
        cpLoss,
        motifs: node.motifs,
        coachText: node.coachText,
        coachSource: node.coachSource,
        phase,
      });

      // Tally motifs
      for (const m of node.motifs) {
        motifMap.set(m, (motifMap.get(m) ?? 0) + 1);
      }
    }
  }

  const acpl = humanMoveCount > 0 ? totalCpLoss / humanMoveCount : 0;

  // Top 3 key moments
  const keyMoments = allMoments
    .sort((a, b) => b.cpLoss - a.cpLoss)
    .slice(0, 3);

  // Motif tally
  const motifTally: MotifTally[] = Array.from(motifMap.entries())
    .map(([motif, count]) => ({ motif, count }))
    .sort((a, b) => b.count - a.count);

  const totalPlies = plyIndex;

  const narrative = buildNarrative({
    phases,
    keyMoments,
    motifTally,
    bestStreak,
    blunders,
    mistakes: mistakeCount,
    inaccuracies,
    totalPlies,
  });

  return {
    totalPlies,
    acpl,
    phases,
    keyMoments,
    motifTally,
    bestStreak,
    blunders,
    mistakes: mistakeCount,
    inaccuracies,
    goodOrBetter,
    narrative,
  };
}

/* ─── Narrative Builder ────────────────────────────────────────────── */

interface NarrativeInput {
  phases: Record<GamePhase, PhaseStat>;
  keyMoments: KeyMoment[];
  motifTally: MotifTally[];
  bestStreak: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  totalPlies: number;
}

function buildNarrative(input: NarrativeInput): string {
  const {
    phases, keyMoments, motifTally, bestStreak,
    blunders, mistakes, inaccuracies,
    totalPlies,
  } = input;

  const parts: string[] = [];
  const totalBad = blunders + mistakes + inaccuracies;
  const moveCount = Math.ceil(totalPlies / 2);

  // 1. Opening sentence — overall feel
  if (totalBad === 0) {
    parts.push(`Clean game — ${moveCount} moves with no significant mistakes.`);
  } else if (blunders >= 3) {
    parts.push(`Rough game — ${blunders} blunder${blunders !== 1 ? 's' : ''} across ${moveCount} moves.`);
  } else if (totalBad <= 2) {
    parts.push(`Solid game — only ${totalBad} imprecise move${totalBad !== 1 ? 's' : ''} in ${moveCount} moves.`);
  } else {
    parts.push(`${moveCount} moves played, with ${totalBad} inaccurate move${totalBad !== 1 ? 's' : ''} to learn from.`);
  }

  // 2. Phase breakdown — which phase was cleanest / roughest
  const phaseEntries = (Object.entries(phases) as [GamePhase, PhaseStat][])
    .filter(([, ps]) => ps.moves > 0);

  if (phaseEntries.length > 1) {
    const cleanest = phaseEntries.reduce((best, cur) =>
      (cur[1].blunders + cur[1].mistakes) < (best[1].blunders + best[1].mistakes) ? cur : best
    );
    const roughest = phaseEntries.reduce((worst, cur) =>
      (cur[1].blunders + cur[1].mistakes) > (worst[1].blunders + worst[1].mistakes) ? cur : worst
    );

    const cleanBad = cleanest[1].blunders + cleanest[1].mistakes;
    const roughBad = roughest[1].blunders + roughest[1].mistakes;

    if (cleanBad === 0 && roughBad > 0) {
      parts.push(
        `Your ${phaseLabel(cleanest[0])} was clean (${cleanest[1].moves} moves, no mistakes), ` +
        `but the ${phaseLabel(roughest[0])} was where things went wrong.`
      );
    } else if (roughBad > 0 && cleanest[0] !== roughest[0]) {
      parts.push(
        `Most trouble came in the ${phaseLabel(roughest[0])} ` +
        `(${roughBad} mistake${roughBad !== 1 ? 's' : ''}).`
      );
    }
  }

  // 3. Worst moment
  if (keyMoments.length > 0) {
    const worst = keyMoments[0];
    parts.push(
      `Biggest miss: ${worst.playerMove} on move ${worst.moveNumber} ` +
      `(${QUALITY_LABELS[worst.quality].toLowerCase()}, lost ${cpToPawns(worst.cpLoss)}).`
    );
  }

  // 4. Motif focus (if any)
  if (motifTally.length > 0) {
    const top = motifTally.slice(0, 2);
    const labels = top.map((t) =>
      `${MOTIF_LABELS[t.motif] ?? t.motif}${t.count > 1 ? ` (${t.count}×)` : ''}`
    );
    parts.push(`Focus areas: ${labels.join(', ')}.`);
  }

  // 5. Positive note
  if (bestStreak >= 5) {
    parts.push(`Nice streak of ${bestStreak} strong moves in a row.`);
  }

  return parts.join(' ');
}
