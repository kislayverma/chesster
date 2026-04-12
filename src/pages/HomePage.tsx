/**
 * HomePage — three rendering states based on auth + journey:
 *
 *   1. Not logged in → generic hero + feature cards.
 *   2. Logged in, not calibrated → journey pitch + level ladder + CTA.
 *   3. Logged in, calibrated → greeting + full journey ladder (current highlighted) + progress bar + play CTA.
 */

import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';
import { useProfileStore } from '../profile/profileStore';
import { acplToRating, ratingStanding, ALL_LEVELS, getLevelDef, nextLevel } from '../lib/rating';
import PromotionBanner from '../components/PromotionBanner';
import CalibrationCard from '../components/CalibrationCard';

/** Chess piece Unicode for each level. */
const LEVEL_PIECES: Record<string, string> = {
  newcomer: '\u2659',        // pawn
  learner: '\u2658',         // knight
  clubPlayer: '\u2657',      // bishop
  competitor: '\u2656',      // rook
  advancedThinker: '\u2655', // queen
  expert: '\u2654',          // king
};

export default function HomePage() {
  const authStatus = useAuthStore((s) => s.status);
  const isAuthenticated = authStatus === 'authenticated';

  const totalGames = useProfileStore((s) => s.profile.totalGames);
  const totalMoves = useProfileStore((s) => s.profile.totalMoves);
  const acplHistory = useProfileStore((s) => s.profile.acplHistory);
  const journey = useProfileStore((s) => s.profile.journeyState);

  const latestAcpl =
    acplHistory.length > 0
      ? acplHistory[acplHistory.length - 1].acpl
      : null;
  const latestRating = latestAcpl != null ? acplToRating(latestAcpl) : null;
  const latestStanding = latestRating != null ? ratingStanding(latestRating) : null;

  const calibrated = isAuthenticated && journey?.calibrated;
  const inCalibration = isAuthenticated && !journey?.calibrated;

  // ── State 2: Logged in, not yet calibrated ──────────────────────
  if (inCalibration) {
    return (
      <main className="mx-auto flex max-w-4xl flex-1 flex-col gap-10 p-6">
        {/* Hero row: heading + calibration card side by side */}
        <section className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          <div className="flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
              Your Chess Journey Starts Here
            </h1>
            <p className="mt-2 text-base leading-relaxed text-slate-400">
              Chesster tracks your games, finds your weaknesses, and helps you
              improve step by step. Play 2 games and we'll find your starting
              level.
            </p>
          </div>
          <div className="sm:w-72 sm:flex-shrink-0">
            <CalibrationCard />
          </div>
        </section>

        {/* Horizontal journey ladder with chess pieces */}
        <JourneyLadder />

        <FeatureCards />
      </main>
    );
  }

  // ── State 3: Logged in, calibrated ──────────────────────────────
  if (calibrated) {
    const name = journey?.displayName || 'there';
    const hour = new Date().getHours();
    const greeting =
      hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const levelDef = getLevelDef(journey?.currentLevel ?? 'newcomer');
    const next = nextLevel(journey?.currentLevel ?? 'newcomer');
    const progress = journey?.levelProgress ?? 0;

    return (
      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-8 p-6">
        <PromotionBanner />

        {/* Greeting */}
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
          {greeting}, {name}
        </h1>

        {/* Full journey ladder with current level highlighted */}
        <JourneyLadder currentLevel={levelDef.key} />

        {/* Progress bar */}
        <div className="w-full max-w-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>{levelDef.name}</span>
            <span>{next ? next.name : 'Max level'}</span>
          </div>
          <div className="h-3 rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <p className="mt-1 text-center text-xs text-slate-500">
            {next ? `${progress}% to ${next.name}` : 'You\'ve reached the top!'}
          </p>
        </div>

        {/* Play CTA */}
        <NavLink
          to="/play"
          className="rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white shadow-lg hover:bg-emerald-500 transition-colors"
        >
          Play a game
        </NavLink>
      </main>
    );
  }

  // ── State 1: Not logged in (default) ────────────────────────────
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 p-6">
      {/* Hero */}
      <section className="flex max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-100">
          Welcome to Chesster
        </h1>
        <p className="text-lg leading-relaxed text-slate-400">
          Play against Stockfish, get move-by-move coaching from an AI coach,
          and track your weaknesses over time — all in your browser.
        </p>
        <NavLink
          to="/play"
          className="mt-2 rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white shadow-lg hover:bg-emerald-500 transition-colors"
        >
          Play now
        </NavLink>
      </section>

      {/* Quick stats */}
      {totalGames > 0 && (
        <section className="grid w-full max-w-lg grid-cols-3 gap-4">
          <StatCard label="Games played" value={String(totalGames)} />
          <StatCard label="Moves analyzed" value={String(totalMoves)} />
          <StatCard
            label="Estimated Rating"
            value={latestRating != null ? String(latestRating) : '—'}
            subtitle={latestStanding ?? 'play a game first'}
          />
        </section>
      )}

      <FeatureCards />
    </main>
  );
}

function FeatureCards() {
  return (
    <section className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
      <FeatureCard
        title="AI Coach"
        description="Get personalized explanations for every mistake, powered by Claude."
        linkTo="/play"
        linkLabel="Start playing"
      />
      <FeatureCard
        title="Game Library"
        description="Revisit any game, replay your moves, and learn from every mistake."
        linkTo="/library"
        linkLabel="View library"
      />
      <FeatureCard
        title="Your Profile"
        description="Track your rating, top weaknesses, and see how you stack up."
        linkTo="/profile"
        linkLabel="View profile"
      />
    </section>
  );
}

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <span className="text-2xl font-bold tabular-nums text-slate-100">
        {value}
      </span>
      <span className="text-xs text-slate-400">{label}</span>
      {subtitle && (
        <span className="mt-0.5 text-[10px] text-slate-500">{subtitle}</span>
      )}
    </div>
  );
}

function JourneyLadder({ currentLevel }: { currentLevel?: string }) {
  return (
    <section className="w-full max-w-2xl rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-slate-500">
        Your Journey
      </h2>
      <div className="flex items-start justify-between gap-1">
        {ALL_LEVELS.map((level, i) => {
          const isCurrent = level.key === currentLevel;
          return (
            <div key={level.key} className="flex flex-1 flex-col items-center gap-1">
              {/* Piece */}
              <span
                className={`leading-none transition-all ${
                  isCurrent
                    ? 'text-5xl text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                    : 'text-3xl text-slate-600 sm:text-4xl'
                }`}
              >
                {LEVEL_PIECES[level.key] ?? '?'}
              </span>
              {/* Connector line (except after the last) */}
              {i < ALL_LEVELS.length - 1 && (
                <div className="absolute" />
              )}
              {/* Label */}
              <span
                className={`text-center leading-tight font-semibold ${
                  isCurrent
                    ? 'text-xs text-emerald-300'
                    : 'text-[11px] text-slate-500'
                }`}
              >
                {level.name}
              </span>
              <span className={`text-[10px] ${isCurrent ? 'text-slate-400' : 'text-slate-600'}`}>
                {level.floor > 0 ? `${level.floor}+` : '< 900'}
              </span>
            </div>
          );
        })}
      </div>
      {/* Connecting track */}
      <div className="mx-auto mt-1 flex items-center px-[8%]">
        <div className="h-px flex-1 bg-slate-700" />
      </div>
    </section>
  );
}

function FeatureCard({
  title,
  description,
  linkTo,
  linkLabel,
}: {
  title: string;
  description: string;
  linkTo: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="flex-1 text-xs leading-relaxed text-slate-400">
        {description}
      </p>
      <NavLink
        to={linkTo}
        className="mt-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
      >
        {linkLabel} &rarr;
      </NavLink>
    </div>
  );
}
