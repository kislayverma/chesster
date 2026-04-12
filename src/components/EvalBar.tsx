/**
 * Phase 2 eval bar.
 *
 * Reads `evalCp` / `mate` / `thinking` from the game store and renders
 * a vertical bar whose fill represents the current evaluation from
 * WHITE's perspective. The store already normalizes Stockfish's
 * side-to-move output into white-perspective numbers, so this
 * component can stay dumb.
 *
 * Mapping from centipawns to fill-percentage uses a squash curve so
 * that small edges register visually but huge evals don't saturate
 * the bar instantly:
 *
 *     pct = 50 + 50 * tanh(cp / 400)
 *
 * This yields ~50% at +0, ~62% at +1 pawn, ~76% at +2 pawns, ~92% at
 * +5 pawns. Mate scores saturate to 0 / 100.
 */

import { useGameStore } from '../game/gameStore';

function evalToPct(cp: number | null, mate: number | null): number {
  if (mate != null) {
    return mate > 0 ? 100 : 0;
  }
  if (cp == null) return 50;
  const t = Math.tanh(cp / 400);
  return 50 + 50 * t;
}

function formatEval(cp: number | null, mate: number | null): string {
  if (mate != null) {
    return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  }
  if (cp == null) return '0.0';
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

interface EvalBarProps {
  /** Flip the bar so white is on the bottom (mirrors board orientation). */
  orientation?: 'white' | 'black';
}

export default function EvalBar({ orientation = 'white' }: EvalBarProps) {
  const evalCp = useGameStore((s) => s.evalCp);
  const mate = useGameStore((s) => s.mate);
  const thinking = useGameStore((s) => s.thinking);
  const depth = useGameStore((s) => s.evalDepth);

  const whitePct = evalToPct(evalCp, mate);
  const label = formatEval(evalCp, mate);

  // When the board is flipped, white sits at the bottom of the bar too,
  // so the "white fill" grows upward from the bottom. For normal
  // orientation (white at bottom), that's already the case; for black
  // orientation, we flip the column so the white fill anchors to the top.
  const flip = orientation === 'black';

  return (
    <div className="flex h-full flex-col items-center gap-2">
      <div
        className="relative h-[480px] w-6 overflow-hidden rounded border border-slate-700 bg-slate-900"
        title={`Stockfish eval ${label}${depth ? ` @ d${depth}` : ''}`}
      >
        {/* Black fill — anchors to the opposite end of white's fill. */}
        <div
          className="absolute inset-x-0 bg-slate-200"
          style={
            flip
              ? { top: 0, height: `${whitePct}%` }
              : { bottom: 0, height: `${whitePct}%` }
          }
        />
        <div
          className="absolute inset-x-0 bg-slate-950"
          style={
            flip
              ? { bottom: 0, height: `${100 - whitePct}%` }
              : { top: 0, height: `${100 - whitePct}%` }
          }
        />
        {/* Midline marker */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-slate-500/60" />
      </div>

      <div className="flex w-6 flex-col items-center text-xs">
        <span className="font-mono tabular-nums text-slate-200 text-[10px]">{label}</span>
        <span className="text-[10px] text-slate-500">
          {thinking ? '…' : depth ? `d${depth}` : '—'}
        </span>
      </div>
    </div>
  );
}
