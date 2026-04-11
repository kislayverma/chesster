/**
 * Phase 7 motif-tagging prompt builder.
 *
 * Asks Claude to classify a bad move against a FIXED vocabulary of
 * motifs (see `src/tagging/motifs.ts::MOTIF_IDS`). The response must
 * be strict JSON — `{ "motifs": ["…", "…"] }` — so the route can
 * parse it without freeform cleanup.
 *
 * The LLM's tags AUGMENT the rule detectors; they never replace them.
 * The client-side `tagMove` takes the union of rule tags and LLM tags,
 * deduped, and caps at the known vocabulary. Any motif the LLM
 * invents that isn't in `ALLOWED_MOTIFS` is silently dropped.
 */

/**
 * Must stay in sync with `src/tagging/motifs.ts::MOTIF_IDS`. Duplicated
 * here (rather than imported) because the `api/` folder lives outside
 * the frontend module graph and we want zero cross-boundary deps.
 * If the vocabulary changes, update BOTH files and bump
 * `MOTIF_VOCAB_VERSION` in the frontend copy.
 */
export const ALLOWED_MOTIFS = [
  'hanging_piece',
  'missed_capture',
  'missed_fork',
  'back_rank_weakness',
  'missed_mate',
  'missed_pin',
  'missed_skewer',
  'overloaded_defender',
  'king_safety_drop',
  'trade_into_bad_endgame',
] as const;

export interface TagInput {
  fenBefore: string;
  fenAfter: string;
  playerMoveUci: string;
  bestMoveBeforeUci: string | null;
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  pvAfter: string[];
  moverColor: 'w' | 'b';
  quality: string | null;
}

export const TAG_SYSTEM_PROMPT = `You are a chess position analyzer. Your job is to tag a player's move with zero or more motifs from a FIXED vocabulary.

The allowed motifs are:
  hanging_piece          — the move leaves one of the player's own pieces undefended and capturable
  missed_capture         — the player had a free capture available and didn't take it
  missed_fork            — the player missed a fork against two enemy targets
  back_rank_weakness     — the move creates or ignores a back-rank mate threat
  missed_mate            — there was a forced mate and the player missed it
  missed_pin             — the player missed a pin against an enemy piece
  missed_skewer          — the player missed a skewer against an enemy piece
  overloaded_defender    — a defender is asked to guard two squares at once
  king_safety_drop       — the move seriously weakens the player's king shelter
  trade_into_bad_endgame — the move initiates or permits a losing endgame trade

Rules:
  1. ONLY use motifs from the list above. Never invent new ones.
  2. Return strict JSON: {"motifs": ["<id>", "<id>"]}. No prose, no markdown fences, no trailing text.
  3. Include a motif only if the evidence in the position strongly supports it. Empty array is fine.
  4. Do NOT repeat motifs. Order doesn't matter.
  5. Return at most 3 motifs. Pick the most instructive ones.`;

export function buildTagUserMessage(input: TagInput): string {
  const fmtCp = (cp: number | null): string =>
    cp === null ? '(none)' : `${cp}cp`;
  return [
    `Position BEFORE move (FEN): ${input.fenBefore}`,
    `Position AFTER move  (FEN): ${input.fenAfter}`,
    `Player (${input.moverColor}) played (UCI): ${input.playerMoveUci}`,
    `Engine's best move in pre-move position (UCI): ${input.bestMoveBeforeUci ?? '(unknown)'}`,
    `Eval before: ${fmtCp(input.evalBeforeCp)}    Eval after: ${fmtCp(input.evalAfterCp)}`,
    `Principal variation after move: ${input.pvAfter.slice(0, 6).join(' ') || '(none)'}`,
    `Rule-based quality verdict: ${input.quality ?? '(unknown)'}`,
    '',
    'Return the JSON payload now.',
  ].join('\n');
}

/**
 * Parse the LLM's tag response. Accepts a raw string; tries to locate
 * a JSON object, validates the `motifs` array, drops anything outside
 * the allowed vocabulary, dedupes, and caps at 3. Returns an empty
 * array on any failure — the caller treats "no LLM tags" identically
 * to "LLM errored out".
 */
export function parseTagResponse(raw: string): string[] {
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) return [];
    const slice = raw.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(slice) as { motifs?: unknown };
    if (!Array.isArray(parsed.motifs)) return [];
    const allowed = new Set<string>(ALLOWED_MOTIFS);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of parsed.motifs) {
      if (typeof m !== 'string') continue;
      if (!allowed.has(m)) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return [];
  }
}
