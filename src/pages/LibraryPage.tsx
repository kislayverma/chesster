/**
 * Phase 10 LibraryPage — saved games list grouped by date.
 *
 * Lists all persisted games from IndexedDB (via `listGames()`),
 * sorted by most recently updated and grouped by calendar date.
 * Results are shown from the player's perspective ("You won" / "You lost").
 * Clicking opens the game review page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { listGames, deleteGame, loadGame, purgeStaleUnfinished } from '../game/gameStorage';
import { deserializeTree } from '../game/gameStorage';
import { useGameStore } from '../game/gameStore';
import type { PersistedGameIndexEntry } from '../profile/types';

/** Date-only string for grouping (e.g. "Apr 12, 2026"). */
function formatDateGroup(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ts));
  } catch {
    return 'Unknown date';
  }
}

/** Time-only for individual cards. */
function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

/** Player-perspective result label + color class. */
function playerResult(
  result: string | null,
  humanColor: 'w' | 'b',
): { label: string; colorClass: string } {
  if (!result) return { label: 'In progress', colorClass: 'text-slate-400' };
  if (result === '1/2-1/2') return { label: 'Draw', colorClass: 'text-slate-300' };

  const humanIsWhite = humanColor === 'w';
  const whiteWon = result === '1-0';
  const playerWon = humanIsWhite ? whiteWon : !whiteWon;

  if (playerWon) return { label: 'You won', colorClass: 'text-emerald-400' };
  return { label: 'You lost', colorClass: 'text-rose-400' };
}

/** Group games by date string, preserving order. */
function groupByDate(
  games: PersistedGameIndexEntry[],
): Array<{ date: string; games: PersistedGameIndexEntry[] }> {
  const groups: Array<{ date: string; games: PersistedGameIndexEntry[] }> = [];
  const seen = new Map<string, PersistedGameIndexEntry[]>();

  for (const g of games) {
    const key = formatDateGroup(g.updatedAt);
    const existing = seen.get(key);
    if (existing) {
      existing.push(g);
    } else {
      const arr = [g];
      seen.set(key, arr);
      groups.push({ date: key, games: arr });
    }
  }
  return groups;
}

/** Small colored dots summarizing quality breakdown for a finished game. */
function QualityDots({ entry }: { entry: PersistedGameIndexEntry }) {
  const { blunders, mistakes, inaccuracies, acpl } = entry;
  // Only show for finished games that have quality data.
  if (entry.finishedAt === null) return null;
  if (blunders == null && mistakes == null && inaccuracies == null) return null;

  const b = blunders ?? 0;
  const m = mistakes ?? 0;
  const i = inaccuracies ?? 0;
  const total = b + m + i;
  if (total === 0 && acpl != null) {
    return (
      <span className="text-[10px] text-emerald-500" title={`ACPL ${acpl} — clean game`}>
        Clean
      </span>
    );
  }

  // Build dot array: up to 5 dots, most severe first.
  const dots: Array<{ color: string; title: string }> = [];
  for (let d = 0; d < Math.min(b, 3); d++) dots.push({ color: 'bg-rose-500', title: 'Blunder' });
  for (let d = 0; d < Math.min(m, 3); d++) dots.push({ color: 'bg-orange-500', title: 'Mistake' });
  for (let d = 0; d < Math.min(i, 3); d++) dots.push({ color: 'bg-amber-400', title: 'Inaccuracy' });
  // Cap at 5 visible dots.
  const visible = dots.slice(0, 5);
  const overflow = total - visible.length;

  return (
    <span
      className="flex items-center gap-0.5"
      title={`${b} blunder${b !== 1 ? 's' : ''}, ${m} mistake${m !== 1 ? 's' : ''}, ${i} inaccurac${i !== 1 ? 'ies' : 'y'}${acpl != null ? ` · ACPL ${acpl}` : ''}`}
    >
      {visible.map((dot, idx) => (
        <span key={idx} className={`inline-block h-1.5 w-1.5 rounded-full ${dot.color}`} />
      ))}
      {overflow > 0 && (
        <span className="text-[9px] text-slate-500">+{overflow}</span>
      )}
    </span>
  );
}

export default function LibraryPage() {
  const [games, setGames] = useState<PersistedGameIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const resumeGame = useGameStore((s) => s.resumeGame);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listGames();
    setGames(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Purge stale unfinished games (>7 days old), then load the list.
    void purgeStaleUnfinished().then(() => refresh());
  }, [refresh]);

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm('Delete this game? This cannot be undone.')) return;
      await deleteGame(id);
      await refresh();
    },
    [refresh],
  );

  const handleResume = useCallback(
    async (id: string, humanColor: 'w' | 'b', engineEnabled: boolean, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const game = await loadGame(id);
      if (!game) return;
      const tree = deserializeTree(game.tree);
      resumeGame(tree, humanColor, engineEnabled);
      navigate('/play');
    },
    [resumeGame, navigate],
  );

  const dateGroups = useMemo(() => groupByDate(games), [games]);

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-4 p-3 md:gap-6 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">
          Game Library
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Review past games, spot patterns, and track how you improve over time.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-slate-500">Loading games...</p>
      ) : games.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
          No saved games yet. Play a game on the{' '}
          <NavLink to="/play" className="font-semibold text-slate-200 underline underline-offset-2">
            Play
          </NavLink>{' '}
          page to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {dateGroups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span className="h-px flex-1 bg-slate-800" />
                <span>{group.date}</span>
                <span className="h-px flex-1 bg-slate-800" />
              </h2>
              <div className="flex flex-col gap-2">
                {group.games.map((g) => {
                  const { label, colorClass } = playerResult(g.result, g.humanColor);
                  return (
                    <NavLink
                      key={g.id}
                      to={`/library/${g.id}`}
                      className="group flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 transition-colors hover:border-slate-700 hover:bg-slate-900/60"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 text-sm">
                          <span className={`font-medium ${colorClass}`}>
                            {label}
                          </span>
                          <span className="text-slate-500">&middot;</span>
                          <span className="text-slate-400">
                            {g.mainlinePlies} moves
                          </span>
                          <span className="text-slate-500">&middot;</span>
                          <span className="text-slate-400">
                            as {g.humanColor === 'w' ? 'White' : 'Black'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">
                            {formatTime(g.updatedAt)}
                          </span>
                          <QualityDots entry={g} />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {g.finishedAt === null ? (
                          <button
                            type="button"
                            onClick={(e) =>
                              void handleResume(g.id, g.humanColor, g.engineEnabled, e)
                            }
                            className="rounded bg-emerald-700/60 px-2 py-0.5 text-xs font-medium text-emerald-200 sm:opacity-0 sm:transition-opacity hover:bg-emerald-600/60 sm:group-hover:opacity-100"
                          >
                            Resume
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                            Review &rarr;
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => void handleDelete(g.id, e)}
                          title="Delete game"
                          className="rounded p-1 text-xs text-slate-600 sm:opacity-0 sm:transition-opacity hover:bg-slate-800 hover:text-rose-400 sm:group-hover:opacity-100"
                        >
                          &times;
                        </button>
                      </div>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
