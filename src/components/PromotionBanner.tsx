/**
 * PromotionBanner — celebratory banner shown after a level-up.
 * Dismissable via `dismissPromotion()` in the profile store.
 */

import { useProfileStore } from '../profile/profileStore';
import { getLevelDef } from '../lib/rating';
import { levelFocusAreas } from '../lib/journey';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';

export default function PromotionBanner() {
  const journey = useProfileStore((s) => s.profile.journeyState);
  const dismiss = useProfileStore((s) => s.dismissPromotion);

  if (!journey?.calibrated || journey.lastPromotionDismissed) return null;

  const level = getLevelDef(journey.currentLevel);
  const focusMotifs = levelFocusAreas(journey.currentLevel);
  const isInitialReveal = journey.promotionHistory.length === 1;

  return (
    <div className="relative rounded-lg border border-emerald-500/40 bg-emerald-900/20 p-5">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-3 top-3 text-sm text-slate-400 hover:text-slate-200"
        title="Dismiss"
      >
        &times;
      </button>

      <h2 className="text-lg font-bold text-emerald-300">
        {isInitialReveal
          ? `Your starting level: ${level.name}`
          : `You've reached ${level.name}!`}
      </h2>
      <p className="mt-1 text-sm text-slate-300">{level.description}</p>

      {focusMotifs.length > 0 && (
        <div className="mt-3">
          <span className="text-xs text-slate-400">Focus areas:</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {focusMotifs.map((m) => (
              <span
                key={m}
                className="rounded bg-emerald-900/50 px-2 py-0.5 text-[11px] text-emerald-200"
              >
                {MOTIF_LABELS[m as MotifId] ?? m}
              </span>
            ))}
          </div>
        </div>
      )}

      {level.skillRange && (
        <p className="mt-3 text-xs text-slate-400">
          Try setting AI skill level to {level.skillRange[0]}-
          {level.skillRange[1]} for a good challenge at this level.
        </p>
      )}
    </div>
  );
}
