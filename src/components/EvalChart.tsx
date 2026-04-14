/**
 * Eval chart — plots position evaluation across mainline plies.
 *
 * SVG-based area chart showing white-perspective centipawn evaluation.
 * Mistake/blunder nodes are overlaid as colored dots that can be
 * clicked to navigate to that position in the review board.
 *
 * The chart clamps extreme evaluations to ±600 cp (6 pawns) so that
 * mate scores and wild swings don't flatten the interesting part of
 * the graph.
 */

import { useMemo } from 'react';
import type { MoveNode } from '../game/gameTree';
import type { MoveQuality } from '../game/moveClassifier';

interface EvalChartProps {
  /** Mainline nodes including root (index 0 = root). */
  mainline: MoveNode[];
  /** Which ply is currently selected in the review board. */
  activePly: number;
  /** Callback when a dot/bar is clicked. Receives the ply index. */
  onPlyClick: (ply: number) => void;
  /** Which color the human played as. */
  humanColor: 'w' | 'b';
}

const CLAMP = 600; // ±6 pawns
const HEIGHT = 100;
const DOT_RADIUS = 4;

const QUALITY_DOT_COLORS: Partial<Record<MoveQuality, string>> = {
  blunder: '#f43f5e',   // rose-500
  mistake: '#f97316',   // orange-500
  inaccuracy: '#f59e0b', // amber-500
};

function clampEval(cp: number | null, mate: number | null): number {
  if (mate != null) {
    return mate > 0 ? CLAMP : -CLAMP;
  }
  if (cp == null) return 0;
  return Math.max(-CLAMP, Math.min(CLAMP, cp));
}

export default function EvalChart({
  mainline,
  activePly,
  onPlyClick,
  humanColor,
}: EvalChartProps) {
  const data = useMemo(() => {
    return mainline.map((node) => ({
      eval: clampEval(node.evalCp, node.mate),
      quality: node.quality,
      moverColor: node.moverColor,
    }));
  }, [mainline]);

  if (data.length < 2) return null;

  const width = data.length * 6; // 6px per ply, scales naturally
  const viewWidth = Math.max(width, 200);
  const midY = HEIGHT / 2;

  // Map eval values to Y coordinates (positive = top = good for white)
  const yScale = (cp: number) => midY - (cp / CLAMP) * (midY - 4);

  // Build the area path (filled below the eval line to the center)
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * viewWidth;
    const y = yScale(d.eval);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  // Area: line path, then close along the center line
  const areaPath = `${linePath} L${points[points.length - 1].x},${midY} L${points[0].x},${midY} Z`;

  // Dots for mistakes/blunders (human moves only)
  const dots = data
    .map((d, i) => ({ ...d, ply: i, point: points[i] }))
    .filter(
      (d) =>
        d.ply > 0 &&
        d.moverColor === humanColor &&
        d.quality != null &&
        QUALITY_DOT_COLORS[d.quality] != null
    );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${viewWidth} ${HEIGHT}`}
        className="w-full"
        style={{ minWidth: '200px', maxHeight: '120px' }}
        preserveAspectRatio="none"
      >
        {/* Center line (eval = 0) */}
        <line
          x1={0} y1={midY} x2={viewWidth} y2={midY}
          stroke="rgb(51, 65, 85)" strokeWidth={0.5}
          strokeDasharray="3,3"
        />

        {/* Eval area */}
        <path d={areaPath} fill="rgba(52, 211, 153, 0.15)" />

        {/* Eval line */}
        <path d={linePath} fill="none" stroke="rgb(52, 211, 153)" strokeWidth={1.5} />

        {/* Active ply indicator */}
        {activePly > 0 && activePly < data.length && (
          <line
            x1={points[activePly].x}
            y1={0}
            x2={points[activePly].x}
            y2={HEIGHT}
            stroke="rgba(148, 163, 184, 0.4)"
            strokeWidth={1}
          />
        )}

        {/* Mistake/blunder dots */}
        {dots.map((d) => (
          <circle
            key={d.ply}
            cx={d.point.x}
            cy={d.point.y}
            r={DOT_RADIUS}
            fill={QUALITY_DOT_COLORS[d.quality!]}
            stroke="rgb(15, 23, 42)"
            strokeWidth={1}
            className="cursor-pointer"
            onClick={() => onPlyClick(d.ply)}
          >
            <title>Move {Math.ceil(d.ply / 2)} — {d.quality}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
