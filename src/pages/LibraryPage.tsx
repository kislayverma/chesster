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
import { listGames, deleteGame, loadGame, saveGame, purgeStaleUnfinished } from '../game/gameStorage';
import { deserializeTree } from '../game/gameStorage';
import { useGameStore } from '../game/gameStore';
import { useProfileStore } from '../profile/profileStore';
import type { PersistedGameIndexEntry } from '../profile/types';
import type { GameSource } from '../game/gameTree';
import { importPgnToTree, buildImportMetadata, determineHumanColor } from '../game/pgnImport';
import { trackEvent } from '../lib/analytics';
import { pushGameRemote } from '../sync/syncOrchestrator';

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

/** Source filter tab options. */
type SourceTab = 'all' | 'live' | 'chesscom' | 'lichess';
const SOURCE_TABS: Array<{ key: SourceTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'chesscom', label: 'Chess.com' },
  { key: 'lichess', label: 'Lichess' },
];

function sourceLabel(source?: GameSource): string | null {
  if (!source || source === 'live') return null;
  if (source === 'chesscom') return 'Chess.com';
  if (source === 'lichess') return 'Lichess';
  return 'Imported';
}

function SourceBadge({ source }: { source?: GameSource }) {
  const label = sourceLabel(source);
  if (!label) return null;
  const color = source === 'chesscom' ? 'bg-green-900/40 text-green-300' : 'bg-slate-700/60 text-slate-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${color}`}>
      {label}
    </span>
  );
}

export default function LibraryPage() {
  const [games, setGames] = useState<PersistedGameIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<SourceTab>('all');
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();
  const resumeGame = useGameStore((s) => s.resumeGame);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listGames();
    setGames(list);
    trackEvent('library_viewed', { gameCount: list.length });
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
      trackEvent('library_game_deleted', { gameId: id });
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
      trackEvent('library_game_resumed', { gameId: id });
      const tree = deserializeTree(game.tree);
      resumeGame(tree, humanColor, engineEnabled);
      navigate('/play');
    },
    [resumeGame, navigate],
  );

  const filteredGames = useMemo(() => {
    if (sourceFilter === 'all') return games;
    return games.filter((g) => (g.source ?? 'live') === sourceFilter);
  }, [games, sourceFilter]);

  const dateGroups = useMemo(() => groupByDate(filteredGames), [filteredGames]);

  // Count games per source for tab badges.
  const sourceCounts = useMemo(() => {
    const counts: Record<SourceTab, number> = { all: games.length, live: 0, chesscom: 0, lichess: 0 };
    for (const g of games) {
      const s = (g.source ?? 'live') as SourceTab;
      if (s in counts) counts[s]++;
    }
    return counts;
  }, [games]);

  const hasImportedGames = sourceCounts.chesscom > 0 || sourceCounts.lichess > 0;

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-4 p-3 md:gap-6 md:p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            Game Library
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Review past games, spot patterns, and track how you improve over time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-500"
        >
          Import games
        </button>
      </header>

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); void refresh(); }}
        />
      )}

      {/* Source filter tabs (only show if there are imported games) */}
      {hasImportedGames && (
        <div className="flex gap-1 rounded-lg bg-slate-900/40 p-1">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSourceFilter(tab.key)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                sourceFilter === tab.key
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
              {sourceCounts[tab.key] > 0 && (
                <span className="ml-1 text-slate-500">{sourceCounts[tab.key]}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading games...</p>
      ) : filteredGames.length === 0 ? (
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
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className={`font-medium ${colorClass}`}>
                            {label}
                          </span>
                          <span className="text-slate-500">&middot;</span>
                          <span className="text-slate-400">
                            {g.mainlinePlies} moves
                          </span>
                          {g.importMetadata ? (
                            <>
                              <span className="text-slate-500">&middot;</span>
                              <span className="text-slate-400">
                                vs {g.humanColor === 'w'
                                  ? g.importMetadata.blackPlayer ?? '?'
                                  : g.importMetadata.whitePlayer ?? '?'}
                                {(() => {
                                  const elo = g.humanColor === 'w'
                                    ? g.importMetadata.blackElo
                                    : g.importMetadata.whiteElo;
                                  return elo ? ` (${elo})` : '';
                                })()}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-slate-500">&middot;</span>
                              <span className="text-slate-400">
                                as {g.humanColor === 'w' ? 'White' : 'Black'}
                              </span>
                            </>
                          )}
                          <SourceBadge source={g.source} />
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

// -----------------------------------------------------------------------
// Import Dialog
// -----------------------------------------------------------------------

type ImportPlatform = 'chesscom' | 'lichess';

function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const linkedAccounts = useProfileStore(
    (s) => s.profile.linkedAccounts ?? { chesscom: null, lichess: null },
  );

  const hasAny = linkedAccounts.chesscom || linkedAccounts.lichess;

  const availablePlatforms: ImportPlatform[] = [];
  if (linkedAccounts.chesscom) availablePlatforms.push('chesscom');
  if (linkedAccounts.lichess) availablePlatforms.push('lichess');

  const [platform, setPlatform] = useState<ImportPlatform>(availablePlatforms[0] ?? 'chesscom');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const username =
    platform === 'chesscom' ? linkedAccounts.chesscom : linkedAccounts.lichess;

  const handleImport = async () => {
    if (!username) return;
    setBusy(true);
    setStatus('Fetching games...');
    setError(null);

    try {
      const res = await fetch('/api/import-games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, username, year, month }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data.message ?? `Server error ${res.status}`);
      }

      const data = (await res.json()) as {
        games: Array<{
          pgn: string;
          externalId: string;
          metadata: {
            whitePlayer?: string;
            blackPlayer?: string;
            whiteElo?: number;
            blackElo?: number;
            timeControl?: string;
            playedAt?: number;
          };
        }>;
        count: number;
      };

      // Load existing games to check for duplicates.
      const existing = await listGames();
      const existingIds = new Set(
        existing
          .filter((g) => g.source === platform)
          .map((g) => g.importMetadata?.externalId)
          .filter(Boolean),
      );

      let imported = 0;
      let skipped = 0;

      for (let i = 0; i < data.games.length; i++) {
        const g = data.games[i];
        setStatus(`Importing game ${i + 1} of ${data.games.length}...`);

        // Dedup check.
        if (g.externalId && existingIds.has(g.externalId)) {
          skipped++;
          continue;
        }

        try {
          const { tree, headers } = importPgnToTree(g.pgn);
          const metadata = buildImportMetadata(
            headers,
            platform,
            g.externalId,
            g.metadata.playedAt,
          );
          // Override metadata with richer data from the API response.
          if (g.metadata.whitePlayer) metadata.whitePlayer = g.metadata.whitePlayer;
          if (g.metadata.blackPlayer) metadata.blackPlayer = g.metadata.blackPlayer;
          if (g.metadata.whiteElo) metadata.whiteElo = g.metadata.whiteElo;
          if (g.metadata.blackElo) metadata.blackElo = g.metadata.blackElo;
          if (g.metadata.timeControl) metadata.timeControl = g.metadata.timeControl;

          const humanColor = determineHumanColor(headers, username);

          const persisted = await saveGame({
            tree,
            humanColor,
            engineEnabled: false,
            finishedAt: g.metadata.playedAt ?? tree.startedAt,
            source: platform,
            importMetadata: metadata,
          });

          if (persisted) {
            pushGameRemote(persisted);
            imported++;
          }
        } catch {
          // Skip games that fail to parse (corrupted PGN, etc.).
          skipped++;
        }
      }

      trackEvent('games_imported', { platform, imported, skipped, month: `${year}-${month}` });
      setStatus(`Imported ${imported} game${imported !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : ''}.`);
      setBusy(false);

      // Auto-close after a short delay on success.
      if (imported > 0) {
        setTimeout(onImported, 1500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setStatus(null);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Import games</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          &times; Close
        </button>
      </div>

      {!hasAny ? (
        <p className="text-sm text-slate-400">
          Link your Chess.com or Lichess account in{' '}
          <NavLink to="/settings" className="font-semibold text-slate-200 underline underline-offset-2">
            Settings
          </NavLink>{' '}
          to import games.
        </p>
      ) : (
        <>
          {/* Platform selector */}
          {availablePlatforms.length > 1 && (
            <div className="mb-3 flex gap-2">
              {availablePlatforms.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`rounded px-3 py-1 text-sm ${
                    platform === p
                      ? 'bg-slate-700 text-slate-100'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p === 'chesscom' ? 'Chess.com' : 'Lichess'}
                </button>
              ))}
            </div>
          )}

          <p className="mb-3 text-sm text-slate-400">
            Importing as <span className="font-medium text-slate-200">{username}</span>
          </p>

          {/* Month / Year picker */}
          <div className="mb-4 flex items-center gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i).toLocaleString('en-US', { month: 'long' })}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Year</span>
              <input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10) || now.getFullYear())}
                className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={busy || !username}
            onClick={() => void handleImport()}
            className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Importing...' : 'Import'}
          </button>

          {status && (
            <p className="mt-2 text-sm text-slate-400">{status}</p>
          )}
          {error && (
            <p className="mt-2 text-sm text-rose-400">{error}</p>
          )}
        </>
      )}
    </div>
  );
}
