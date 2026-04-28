/**
 * HomePage — two rendering states based on auth:
 *
 *   1. Not logged in → generic hero + feature cards.
 *   2. Logged in → greeting + full journey ladder (current highlighted) + progress bar + play CTA.
 */

import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';
import { useProfileStore } from '../profile/profileStore';
import { ratingStanding, ALL_LEVELS, getLevelDef, nextLevel } from '../lib/rating';
import { MIN_GAMES_FOR_PROMOTION } from '../lib/journey';
import PromotionBanner from '../components/PromotionBanner';

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
  const syncing = useAuthStore((s) => s.syncing);
  const isAuthenticated = authStatus === 'authenticated';

  const totalGames = useProfileStore((s) => s.profile.totalGames);
  const journey = useProfileStore((s) => s.profile.journeyState);

  // While the remote profile is being fetched, show a loading state so
  // we don't flash stale data from a previous session.
  if (syncing) {
    return (
      <main className="flex flex-1 items-center justify-center p-3 md:p-6">
        <p className="text-sm text-slate-500">Loading your profile...</p>
      </main>
    );
  }

  // ── State 2: Logged in ─────────────────────────────────────────
  if (isAuthenticated) {
    const name = journey?.displayName || 'there';
    const hour = new Date().getHours();
    const greeting =
      hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const levelDef = getLevelDef(journey?.currentLevel ?? 'newcomer');
    const next = nextLevel(journey?.currentLevel ?? 'newcomer');
    const progress = totalGames > 0 ? (journey?.levelProgress ?? 0) : 0;
    const gamesNeeded = Math.max(0, MIN_GAMES_FOR_PROMOTION - (journey?.gamesAtCurrentLevel ?? 0));

    return (
      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-6 p-3 md:gap-8 md:p-6">
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
          {totalGames > 0 && journey?.rollingRating != null && journey.rollingRating > 0 && (
            <p className="mt-1 text-center text-sm font-semibold text-slate-200">
              Current Rating: ~{journey.rollingRating}{' '}
              <span className="font-normal text-slate-400">
                ({ratingStanding(journey.rollingRating)})
              </span>
            </p>
          )}
          <p className="mt-1 text-center text-xs text-slate-500">
            {next
              ? progress >= 99 && gamesNeeded > 0
                ? `Almost there — play ${gamesNeeded} more game${gamesNeeded !== 1 ? 's' : ''} to promote`
                : `${progress}% to ${next.name}`
              : 'You\'ve reached the top!'}
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
    <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-6 p-3 md:gap-10 md:p-6">
      {/* Hero */}
      <section className="flex max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-100">
          Welcome to altmove
        </h1>
        <p className="text-lg leading-relaxed text-slate-400">
          Play against Stockfish, get move-by-move coaching from an AI coach,
          and track your weaknesses over time — all in your browser.
        </p>
      </section>

      {/* Journey ladder — neutral preview (no level highlighted) */}
      <JourneyLadder />

      {/* Sign in CTA */}
      <section className="flex flex-col items-center gap-3 text-center">
        <NavLink
          to="/login"
          className="rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white shadow-lg hover:bg-emerald-500 transition-colors"
        >
          Sign in to start your chess journey
        </NavLink>
        <p className="text-xs text-slate-500">
          Free to use. We just need an email to save your progress.
        </p>
      </section>

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
      />
      <FeatureCard
        title="Game Library"
        description="Revisit any game, replay your moves, and learn from every mistake."
      />
      <FeatureCard
        title="Your Profile"
        description="Track your rating, top weaknesses, and see how you stack up."
      />
    </section>
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
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="flex-1 text-xs leading-relaxed text-slate-400">
        {description}
      </p>
    </div>
  );
}
