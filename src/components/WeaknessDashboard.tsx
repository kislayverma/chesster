/**
 * Phase 5 weakness dashboard.
 *
 * Read-only visualization of the player's current profile. Used by
 * `DashboardPage` and optionally embedded anywhere on the right rail.
 * No chart library — the bars and sparkline are plain CSS so the
 * bundle stays tight.
 *
 * Sections:
 *   • Overview    — totalGames, totalMoves, most recent ACPL
 *   • Top motifs  — horizontal bar graph driven by `getTopWeaknesses`
 *   • Phase CP loss — three bars (opening / middlegame / endgame)
 *   • ACPL trend  — sparkline over `acplHistory`
 *   • Retired     — motifs whose decayed count dropped below threshold
 */

import { useProfileStore } from '../profile/profileStore';
import {
  getTopWeaknesses,
  getRetiredWeaknesses,
} from '../profile/weaknessSelector';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import type { PlayerProfile } from '../profile/types';

interface Props {
  /** Override — pass a profile explicitly (e.g. for a tutorial preview). */
  profile?: PlayerProfile;
  /** Hide the retired-weaknesses block when false. Default true. */
  showRetired?: boolean;
}

function labelFor(motif: string): string {
  return MOTIF_LABELS[motif as MotifId] ?? motif;
}

export default function WeaknessDashboard({
  profile: profileOverride,
  showRetired = true,
}: Props) {
  const profileFromStore = useProfileStore((s) => s.profile);
  const profile = profileOverride ?? profileFromStore;

  const top = getTopWeaknesses(profile, 5);
  const retired = showRetired ? getRetiredWeaknesses(profile) : [];
  const topMax = top.length > 0 ? Math.max(...top.map((w) => w.decayedCount)) : 1;

  const phaseEntries: Array<{ key: 'opening' | 'middlegame' | 'endgame'; label: string }> = [
    { key: 'opening', label: 'Opening' },
    { key: 'middlegame', label: 'Middlegame' },
    { key: 'endgame', label: 'Endgame' },
  ];
  const phaseMax = Math.max(
    1,
    profile.phaseCpLoss.opening,
    profile.phaseCpLoss.middlegame,
    profile.phaseCpLoss.endgame
  );

  const latestAcpl =
    profile.acplHistory.length > 0
      ? profile.acplHistory[profile.acplHistory.length - 1].acpl
      : null;

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-slate-200">
      {/* Overview */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Games" value={profile.totalGames.toString()} />
        <Stat label="Moves" value={profile.totalMoves.toString()} />
        <Stat
          label="Last ACPL"
          value={latestAcpl != null ? latestAcpl.toFixed(0) : '—'}
        />
      </div>

      {/* Top motifs */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Current weaknesses
        </h3>
        {top.length === 0 ? (
          <p className="text-xs text-slate-500">
            Play a few games and any mistakes will surface here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((w) => {
              const pct = Math.round((w.decayedCount / topMax) * 100);
              return (
                <li key={w.motif} className="text-xs">
                  <div className="mb-1 flex justify-between text-slate-300">
                    <span>{labelFor(w.motif)}</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {w.count} · avg {Math.round(w.avgCpLoss)}cp
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-slate-800">
                    <div
                      className="h-full bg-amber-500/80"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Phase breakdown */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Average cp loss by phase
        </h3>
        <ul className="flex flex-col gap-2">
          {phaseEntries.map(({ key, label }) => {
            const value = profile.phaseCpLoss[key];
            const pct = Math.round((value / phaseMax) * 100);
            return (
              <li key={key} className="text-xs">
                <div className="mb-1 flex justify-between text-slate-300">
                  <span>{label}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {value > 0 ? value.toFixed(0) : '—'}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full bg-sky-500/80"
                    style={{ width: `${value > 0 ? pct : 0}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ACPL sparkline */}
      {profile.acplHistory.length > 1 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            ACPL over time
          </h3>
          <Sparkline values={profile.acplHistory.map((a) => a.acpl)} />
        </section>
      )}

      {/* Retired motifs */}
      {showRetired && retired.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-400/80">
            Retired weaknesses
          </h3>
          <div className="flex flex-wrap gap-1">
            {retired.map((w) => (
              <span
                key={w.motif}
                className="rounded bg-emerald-900/50 px-2 py-0.5 text-[11px] text-emerald-200"
                title={`Used to trip on this (${w.count} times) but not recently.`}
              >
                {labelFor(w.motif)}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-800/60 px-2 py-2">
      <div className="font-mono text-lg tabular-nums text-slate-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const w = 200;
  const h = 40;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / span) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-10 w-full"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-sky-400"
        points={points}
      />
    </svg>
  );
}
