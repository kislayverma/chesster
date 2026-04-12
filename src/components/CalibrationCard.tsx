/**
 * CalibrationCard — shown during the first 2 games while the system
 * determines the player's initial level.  Only for authenticated users.
 */

import { NavLink } from 'react-router-dom';
import { useProfileStore } from '../profile/profileStore';
import { CALIBRATION_GAMES } from '../lib/journey';

export default function CalibrationCard() {
  const journey = useProfileStore((s) => s.profile.journeyState);

  if (!journey || journey.calibrated) return null;

  const played = journey.calibrationGamesPlayed ?? 0;
  const remaining = CALIBRATION_GAMES - played;

  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-900/10 p-5">
      <h2 className="text-lg font-bold text-amber-300">
        Calibrating your level...
      </h2>
      <p className="mt-1 text-sm text-slate-300">
        {played === 0
          ? `Play ${CALIBRATION_GAMES} games and we'll find your starting level.`
          : `${remaining} more game${remaining !== 1 ? 's' : ''} to go — almost there!`}
      </p>

      {/* Progress dots */}
      <div className="mt-3 flex gap-2">
        {Array.from({ length: CALIBRATION_GAMES }, (_, i) => (
          <div
            key={i}
            className={`h-3 w-3 rounded-full ${
              i < played
                ? 'bg-amber-400'
                : 'border border-slate-600 bg-slate-800'
            }`}
          />
        ))}
      </div>

      {played === 0 && (
        <NavLink
          to="/play"
          className="mt-4 inline-block rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Play your first game
        </NavLink>
      )}
      {played > 0 && (
        <NavLink
          to="/play"
          className="mt-4 inline-block rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Play game {played + 1} of {CALIBRATION_GAMES}
        </NavLink>
      )}
    </section>
  );
}
