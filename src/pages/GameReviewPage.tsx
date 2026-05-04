/**
 * Phase 10 GameReviewPage — replay a saved game.
 *
 * Loads a `PersistedGame` by route param `:gameId`, deserializes the
 * tree, and provides read-only navigation (forward/back) through the
 * mainline. Shows the board, move list, and per-move coach comments
 * as they were captured during live play.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, NavLink } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { Arrow, CustomSquareStyles, Square } from 'react-chessboard/dist/chessboard/types';
import { loadGame, deserializeTree, saveGame } from '../game/gameStorage';
import { walkMainline } from '../game/gameTree';
import type { GameTree, MoveNode } from '../game/gameTree';
import type { PersistedGame } from '../profile/types';
import { useProfileStore } from '../profile/profileStore';
import { useAuthStore } from '../auth/authStore';
import { classifyMove, QUALITY_COLORS, QUALITY_LABELS, type MoveQuality } from '../game/moveClassifier';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import { computeGameSummary, type GameSummary } from '../game/gameSummary';
import GameSummaryCard from '../components/GameSummaryCard';
import EvalChart from '../components/EvalChart';
import { hasLLM, withByokHeader } from '../lib/featureFlags';
import { getCurrentProfileSummary } from '../profile/profileStore';
import { acplToRating, ratingStanding } from '../lib/rating';
import { trackEvent } from '../lib/analytics';
import { isTreeAnalyzed, analyzeImportedGame, type AnalysisProgress } from '../game/analyzeImportedGame';

const LAST_MOVE_STYLE: Record<string, string | number> = {
  backgroundColor: 'rgba(255, 255, 0, 0.3)',
};

const COACH_ARROW_COLOR = 'rgb(245, 158, 11)';

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

export default function GameReviewPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const [game, setGame] = useState<PersistedGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current position index into the mainline node list.
  const [plyIndex, setPlyIndex] = useState(0);

  // On-demand Stockfish analysis state for imported games.
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  // Bumped to force re-derivation of tree/mainline after analysis completes.
  const [analysisVersion, setAnalysisVersion] = useState(0);

  // Track whether we've applied the initial ?move= param.
  const appliedInitialMove = useRef(false);

  useEffect(() => {
    if (!gameId) {
      setError('No game ID provided.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    void loadGame(gameId).then((g) => {
      if (cancelled) return;
      if (!g) {
        setError('Game not found.');
      } else {
        setGame(g);
        trackEvent('game_review_opened', { gameId, isFinished: g.finishedAt != null });
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [gameId]);

  const tree: GameTree | null = useMemo(() => {
    if (!game) return null;
    return deserializeTree(game.tree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, analysisVersion]);

  const mainline: MoveNode[] = useMemo(() => {
    if (!tree) return [];
    return Array.from(walkMainline(tree));
  }, [tree]);

  // Detect whether this is an unanalyzed imported game.
  const needsAnalysis = useMemo(() => {
    if (!tree || !game) return false;
    const src = game.source;
    if (!src || src === 'live') return false;
    return !isTreeAnalyzed(tree);
  }, [tree, game]);

  // Game summary — computed from mainline tree data.
  const gameSummary: GameSummary | null = useMemo(() => {
    if (!tree || !game) return null;
    return computeGameSummary(tree, game.humanColor);
  }, [tree, game]);

  // Run on-demand Stockfish analysis for imported games.
  const runAnalysis = useCallback(async () => {
    if (!tree || !game) return;
    setAnalyzing(true);
    setAnalysisProgress(null);
    const abort = new AbortController();
    analysisAbort.current = abort;
    try {
      await analyzeImportedGame(
        tree,
        (p) => setAnalysisProgress(p),
        abort.signal,
      );
      if (!abort.signal.aborted) {
        // Persist the analyzed tree back to storage.
        await saveGame({
          tree,
          humanColor: game.humanColor,
          engineEnabled: game.engineEnabled,
          finishedAt: game.finishedAt,
          source: game.source,
          importMetadata: game.importMetadata,
        });
        // Bump version to force re-derivation of memos.
        setAnalysisVersion((v) => v + 1);
        trackEvent('imported_game_analyzed', { gameId: game.id });
      }
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(null);
      analysisAbort.current = null;
    }
  }, [tree, game]);

  // Abort analysis on unmount.
  useEffect(() => {
    return () => {
      analysisAbort.current?.abort();
    };
  }, []);

  // LLM-enriched game summary narrative (optional, async).
  const [llmNarrative, setLlmNarrative] = useState<string | null>(null);
  useEffect(() => {
    if (!gameSummary || !hasLLM()) return;
    let cancelled = false;
    const fetchLlmSummary = async () => {
      try {
        const profileSummary = getCurrentProfileSummary();
        const payload = {
          templateNarrative: gameSummary.narrative,
          totalPlies: gameSummary.totalPlies,
          acpl: gameSummary.acpl,
          phases: gameSummary.phases,
          keyMoments: gameSummary.keyMoments.map((km) => ({
            moveNumber: km.moveNumber,
            playerMove: km.playerMove,
            bestMove: km.bestMove,
            quality: km.quality,
            cpLoss: km.cpLoss,
            motifs: km.motifs,
            phase: km.phase,
          })),
          motifTally: gameSummary.motifTally,
          bestStreak: gameSummary.bestStreak,
          blunders: gameSummary.blunders,
          mistakes: gameSummary.mistakes,
          inaccuracies: gameSummary.inaccuracies,
          goodOrBetter: gameSummary.goodOrBetter,
          profileSummary,
        };
        const res = await fetch('/api/summarize-game', {
          method: 'POST',
          headers: withByokHeader({ 'content-type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        if (!res.ok || cancelled) return;
        const body = await res.json() as { summary?: string };
        if (!cancelled && typeof body.summary === 'string') {
          setLlmNarrative(body.summary);
        }
      } catch {
        // Silent fallback — template narrative stays.
      }
    };
    void fetchLlmSummary();
    return () => { cancelled = true; };
  }, [gameSummary]);

  // Mistakes for this game, sorted by move number.
  const allEvents = useProfileStore((s) => s.profile.weaknessEvents);
  const gameMistakes = useMemo(() => {
    if (!gameId) return [];
    return allEvents
      .filter((e) => e.gameId === gameId)
      .sort((a, b) => a.moveNumber - b.moveNumber);
  }, [allEvents, gameId]);

  // Jump to the requested move when the mainline first becomes available.
  // The ?move= param is a 1-based full-move number; ?color= is 'white'|'black'.
  // Ply index = (moveNumber - 1) * 2 + (color === 'black' ? 2 : 1).
  useEffect(() => {
    if (appliedInitialMove.current || mainline.length === 0) return;
    const moveParam = searchParams.get('move');
    if (!moveParam) {
      appliedInitialMove.current = true;
      return;
    }
    const moveNum = parseInt(moveParam, 10);
    if (isNaN(moveNum) || moveNum < 1) {
      appliedInitialMove.current = true;
      return;
    }
    const colorParam = searchParams.get('color') ?? 'white';
    const ply = (moveNum - 1) * 2 + (colorParam === 'black' ? 2 : 1);
    const clamped = Math.min(ply, mainline.length - 1);
    setPlyIndex(clamped);
    appliedInitialMove.current = true;
  }, [mainline, searchParams]);

  // Credit a mistake review for journey progress when navigating from
  // the Mistakes page (detected by the ?move= param).
  const reviewCredited = useRef(false);
  const recordMistakeReview = useProfileStore((s) => s.recordMistakeReview);
  const authStatus = useAuthStore((s) => s.status);
  useEffect(() => {
    if (reviewCredited.current) return;
    if (authStatus !== 'authenticated') return;
    if (!searchParams.get('move')) return;
    reviewCredited.current = true;
    recordMistakeReview();
  }, [authStatus, searchParams, recordMistakeReview]);

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlyIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlyIndex((i) => Math.min(mainline.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mainline.length]);

  const goBack = useCallback(() => {
    setPlyIndex((i) => Math.max(0, i - 1));
  }, []);

  const goForward = useCallback(() => {
    setPlyIndex((i) => Math.min(mainline.length - 1, i + 1));
  }, [mainline.length]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-slate-500">Loading game...</p>
      </main>
    );
  }

  if (error || !game || !tree || mainline.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-slate-400">{error ?? 'Could not load game.'}</p>
        <NavLink
          to="/library"
          className="text-sm text-emerald-400 hover:text-emerald-300"
        >
          &larr; Back to library
        </NavLink>
      </main>
    );
  }

  const currentNode = mainline[plyIndex];
  const fen = currentNode.fen;
  const boardOrientation: 'white' | 'black' =
    game.humanColor === 'w' ? 'white' : 'black';

  // Last-move highlight.
  const squareStyles: CustomSquareStyles = {};
  if (currentNode.uci) {
    const from = currentNode.uci.slice(0, 2) as Square;
    const to = currentNode.uci.slice(2, 4) as Square;
    squareStyles[from] = LAST_MOVE_STYLE;
    squareStyles[to] = LAST_MOVE_STYLE;
  }

  // Best-move arrow for inaccuracies/mistakes/blunders.
  const arrows: Arrow[] = [];
  if (
    currentNode.quality &&
    (currentNode.quality === 'inaccuracy' ||
      currentNode.quality === 'mistake' ||
      currentNode.quality === 'blunder') &&
    currentNode.bestMoveBeforeUci
  ) {
    const from = currentNode.bestMoveBeforeUci.slice(0, 2) as Square;
    const to = currentNode.bestMoveBeforeUci.slice(2, 4) as Square;
    if (from !== to) {
      arrows.push([from, to, COACH_ARROW_COLOR]);
    }
  }

  // Figure out whose move it is at the current node.
  let turnLabel = '';
  try {
    const chess = new Chess(fen);
    turnLabel = chess.turn() === 'w' ? 'White to move' : 'Black to move';
  } catch { /* ignore */ }

  const qualityColors: Record<string, string> = {
    brilliant: 'text-cyan-300',
    great: 'text-blue-300',
    best: 'text-emerald-300',
    good: 'text-slate-300',
    book: 'text-slate-400',
    inaccuracy: 'text-amber-300',
    mistake: 'text-orange-300',
    blunder: 'text-rose-300',
  };

  return (
    <main className={`grid flex-1 grid-cols-1 gap-3 p-3 lg:gap-6 lg:p-6 ${
      gameMistakes.length > 0
        ? 'lg:grid-cols-[auto_260px_260px]'
        : 'lg:grid-cols-[auto_320px]'
    }`}>
      {/* Board section */}
      <section className="flex flex-col items-center gap-4">
        <NavLink
          to="/library"
          className="self-start text-xs text-slate-500 hover:text-slate-300"
        >
          &larr; Back to library
        </NavLink>

        {/* Analysis banner for unanalyzed imported games */}
        {(needsAnalysis || analyzing) && (
          <div className="w-full max-w-[480px] rounded border border-amber-500/40 bg-amber-900/20 p-3">
            {analyzing ? (
              <div>
                <p className="text-sm font-medium text-amber-200">
                  Analyzing with Stockfish...
                </p>
                {analysisProgress && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs text-amber-300/80">
                      <span>Move {analysisProgress.current} of {analysisProgress.total}</span>
                      <span>{Math.round((analysisProgress.current / analysisProgress.total) * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-amber-900/40">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all"
                        style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => analysisAbort.current?.abort()}
                  className="mt-2 text-xs text-amber-300/60 underline underline-offset-2 hover:text-amber-200"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-amber-200">
                    Imported game — not yet analyzed
                  </p>
                  <p className="mt-0.5 text-xs text-amber-300/60">
                    Run Stockfish to see move quality, motifs, and coaching.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void runAnalysis()}
                  className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-500"
                >
                  Analyze
                </button>
              </div>
            )}
          </div>
        )}

        <div className="w-full max-w-[480px]">
          <Chessboard
            position={fen}
            boardOrientation={boardOrientation}
            customSquareStyles={squareStyles}
            customArrows={arrows}
            arePiecesDraggable={false}
            customBoardStyle={{
              borderRadius: '8px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            }}
            animationDuration={150}
          />
        </div>

        {/* Navigation controls */}
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPlyIndex(0)}
            disabled={plyIndex === 0}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            title="Go to start"
          >
            &laquo;
          </button>
          <button
            type="button"
            onClick={goBack}
            disabled={plyIndex === 0}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            title="Previous move (Left arrow)"
          >
            &larr;
          </button>
          <span className="min-w-[10rem] rounded bg-slate-800 px-3 py-1 text-center text-slate-300">
            {plyIndex === 0 ? 'Starting position' : `Move ${Math.ceil(plyIndex / 2)} · ${turnLabel}`}
          </span>
          <button
            type="button"
            onClick={goForward}
            disabled={plyIndex >= mainline.length - 1}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            title="Next move (Right arrow)"
          >
            &rarr;
          </button>
          <button
            type="button"
            onClick={() => setPlyIndex(mainline.length - 1)}
            disabled={plyIndex >= mainline.length - 1}
            className="rounded bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            title="Go to end"
          >
            &raquo;
          </button>
        </div>
      </section>

      {/* Column 2: Coach + Game info + Summary + Move list */}
      <aside className="flex flex-col gap-4">
        {/* Coach panel — per-move coaching feedback */}
        <ReviewCoachPanel
          node={currentNode}
          prevNode={plyIndex > 0 ? mainline[plyIndex - 1] : null}
          humanColor={game.humanColor}
        />

        {/* Game metadata */}
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Game Info</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Date</dt>
            <dd className="text-slate-300">{formatDate(game.startedAt)}</dd>
            <dt className="text-slate-500">Result</dt>
            <dd className="text-slate-300">{game.result ?? 'In progress'}</dd>
            <dt className="text-slate-500">Played as</dt>
            <dd className="text-slate-300">
              {game.humanColor === 'w' ? 'White' : 'Black'}
            </dd>
            <dt className="text-slate-500">Moves</dt>
            <dd className="text-slate-300">{game.mainlinePlies}</dd>
            <dt className="text-slate-500">Opponent</dt>
            <dd className="text-slate-300">
              {game.importMetadata ? (
                (() => {
                  const meta = game.importMetadata;
                  const opponentName = game.humanColor === 'w'
                    ? meta.blackPlayer
                    : meta.whitePlayer;
                  const opponentElo = game.humanColor === 'w'
                    ? meta.blackElo
                    : meta.whiteElo;
                  if (opponentName) {
                    return opponentElo
                      ? `${opponentName} (${opponentElo})`
                      : opponentName;
                  }
                  return 'Unknown';
                })()
              ) : (
                game.engineEnabled ? 'Stockfish' : 'Human'
              )}
            </dd>
            {game.source && game.source !== 'live' && (
              <>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-slate-300">
                  {game.source === 'chesscom' ? 'Chess.com' : game.source === 'lichess' ? 'Lichess' : 'PGN'}
                </dd>
              </>
            )}
            {gameSummary && game.finishedAt && (
              <>
                <dt className="text-slate-500">Your Rating</dt>
                <dd className="font-semibold text-slate-200">
                  ~{acplToRating(gameSummary.acpl)}{' '}
                  <span className="font-normal text-slate-400">
                    ({ratingStanding(acplToRating(gameSummary.acpl))})
                  </span>
                </dd>
              </>
            )}
          </dl>
        </div>

        {/* Eval chart */}
        {mainline.length > 2 && (
          <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">
              Evaluation
            </h2>
            <EvalChart
              mainline={mainline}
              activePly={plyIndex}
              onPlyClick={setPlyIndex}
              humanColor={game.humanColor}
            />
          </div>
        )}

        {/* Game summary */}
        {gameSummary && (
          <GameSummaryCard
            summary={gameSummary}
            llmNarrative={llmNarrative}
            onPlyClick={setPlyIndex}
          />
        )}

        {/* Move list */}
        <div className="min-h-[200px] flex-1 overflow-y-auto rounded border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Moves</h2>
          <div className="flex flex-wrap gap-x-1 gap-y-0.5 text-xs">
            {mainline.slice(1).map((node, i) => {
              const realPly = i + 1;
              const isWhite = realPly % 2 === 1;
              const moveNum = Math.ceil(realPly / 2);
              const isActive = plyIndex === realPly;
              return (
                <span key={node.id} className="inline-flex items-center">
                  {isWhite && (
                    <span className="mr-0.5 text-slate-600">{moveNum}.</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPlyIndex(realPly)}
                    className={`rounded px-1 py-0.5 ${
                      isActive
                        ? 'bg-slate-700 text-slate-100'
                        : `hover:bg-slate-800 ${
                            qualityColors[node.quality ?? ''] ?? 'text-slate-300'
                          }`
                    }`}
                  >
                    {node.move ?? '??'}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Column 3: Mistakes (only rendered when there are mistakes) */}
      {gameMistakes.length > 0 && (
        <aside className="flex flex-col gap-4">
          <div className="flex-1 overflow-y-auto rounded border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">
              Mistakes ({gameMistakes.length})
            </h2>
            <ol className="flex flex-col gap-1.5">
              {gameMistakes.map((evt) => {
                const ply =
                  (evt.moveNumber - 1) * 2 +
                  (evt.color === 'black' ? 2 : 1);
                const isActive = plyIndex === ply;
                return (
                  <li key={evt.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setPlyIndex(Math.min(ply, mainline.length - 1))
                      }
                      className={`w-full rounded p-2 text-left text-xs transition-colors ${
                        isActive
                          ? 'bg-slate-700/80 ring-1 ring-slate-600'
                          : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${QUALITY_COLORS[evt.quality]}`}
                        >
                          {QUALITY_LABELS[evt.quality]}
                        </span>
                        <span className="text-slate-400">
                          Move {evt.moveNumber} · {evt.color}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-slate-300">
                          Played{' '}
                          <span className="font-semibold text-rose-300">
                            {evt.playerMove}
                          </span>
                        </span>
                        {evt.bestMove && (
                          <span className="text-slate-400">
                            · best{' '}
                            <span className="font-semibold text-emerald-300">
                              {evt.bestMove}
                            </span>
                          </span>
                        )}
                      </div>
                      {evt.motifs.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {evt.motifs.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400"
                            >
                              {MOTIF_LABELS[m as MotifId] ?? m}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      )}
    </main>
  );
}

// -----------------------------------------------------------------------
// ReviewCoachPanel — static coaching feedback from a MoveNode
// -----------------------------------------------------------------------

/**
 * Cheap phase detection from FEN for the phase tag display.
 * Mirrors the logic in tagging/phaseDetector.ts but returns a display string.
 */
function detectPhaseFromFen(fen: string): string | null {
  try {
    const parts = fen.split(/\s+/);
    const board = parts[0] ?? '';
    const fullmove = parseInt(parts[5] ?? '1', 10) || 1;

    let whiteQueens = 0;
    let blackQueens = 0;
    let nonKingNonPawnPieces = 0;
    let nonKingPieces = 0;

    for (const ch of board) {
      if (ch === '/') continue;
      if (ch >= '0' && ch <= '9') continue;
      const upper = ch.toUpperCase();
      if (upper === 'K') continue;
      nonKingPieces += 1;
      if (upper !== 'P') nonKingNonPawnPieces += 1;
      if (ch === 'Q') whiteQueens += 1;
      if (ch === 'q') blackQueens += 1;
    }

    const queensOn = whiteQueens > 0 && blackQueens > 0;
    if (fullmove <= 10 && queensOn) return 'Opening';
    if (nonKingNonPawnPieces <= 6) return 'Endgame';
    if (!queensOn && nonKingPieces <= 10) return 'Endgame';
    return 'Middlegame';
  } catch {
    return null;
  }
}

/**
 * Describe the eval shift from the opponent's perspective to explain
 * what their move accomplished (or failed to accomplish).
 */
function describeOpponentMove(
  prevNode: MoveNode | null,
  node: MoveNode,
  resolvedQuality: MoveQuality | null,
  resolvedCpLoss: number,
): string {
  const moveSan = node.move;

  // Check if it was a capture (simple heuristic: 'x' in SAN).
  const isCapture = moveSan.includes('x');
  // Check if it delivers check.
  const isCheck = moveSan.includes('+') || moveSan.includes('#');

  // Build an explanation based on quality + context.
  if (resolvedQuality === 'blunder') {
    return `${moveSan} was a blunder, losing ${(Math.abs(resolvedCpLoss) / 100).toFixed(1)} pawns of advantage. Look for ways to exploit this.`;
  }
  if (resolvedQuality === 'mistake') {
    return `${moveSan} was a mistake — it cost ${(Math.abs(resolvedCpLoss) / 100).toFixed(1)} pawns. The position shifted in your favor.`;
  }
  if (resolvedQuality === 'inaccuracy') {
    return `${moveSan} was a slight inaccuracy. The position is now a bit better for you.`;
  }

  // Good or better moves — explain the intent.
  if (isCheck) {
    return `${moveSan} delivers check, forcing you to respond to the king threat.`;
  }
  if (isCapture) {
    return `${moveSan} captures material.`;
  }

  // Eval-based narrative when we have numbers.
  if (prevNode && node.evalCp != null && prevNode.evalCp != null) {
    const shift = node.evalCp - prevNode.evalCp;
    const moverIsWhite = node.moverColor === 'w';
    // Positive shift = good for white. Convert to "good for mover".
    const moverGain = moverIsWhite ? shift : -shift;
    if (moverGain > 50) {
      return `${moveSan} improves their position by ${(moverGain / 100).toFixed(1)} pawns.`;
    }
    if (moverGain < -50) {
      return `${moveSan} weakens their position — an opportunity for you.`;
    }
  }

  if (resolvedQuality === 'best' || resolvedQuality === 'excellent') {
    return `${moveSan} is a strong move — the engine's top choice in this position.`;
  }
  if (resolvedQuality === 'good') {
    return `${moveSan} is a solid move that maintains the balance.`;
  }

  return `Opponent played ${moveSan}.`;
}

function ReviewCoachPanel({
  node,
  prevNode,
  humanColor,
}: {
  node: MoveNode;
  prevNode: MoveNode | null;
  humanColor: 'w' | 'b';
}) {
  const isRoot = node.parentId === null;
  const isHumanMove = node.moverColor === humanColor;

  // Use stored quality/cpLoss if available; otherwise compute on the fly
  // from neighboring node evals (covers engine moves in live games).
  let resolvedQuality = node.quality;
  let resolvedCpLoss = node.cpLoss ?? 0;

  if (resolvedQuality === null && prevNode && node.moverColor) {
    const hasEvalBefore = prevNode.evalCp !== null || prevNode.mate !== null;
    const hasEvalAfter = node.evalCp !== null || node.mate !== null;
    if (hasEvalBefore && hasEvalAfter) {
      const result = classifyMove({
        evalBeforeCp: prevNode.evalCp,
        evalBeforeMate: prevNode.mate,
        evalAfterCp: node.evalCp,
        evalAfterMate: node.mate,
        moverColor: node.moverColor,
      });
      resolvedQuality = result.quality;
      resolvedCpLoss = result.cpLoss;
    }
  }

  const { motifs, coachText, coachSource, bestMoveBeforeUci } = node;
  const isBad =
    resolvedQuality === 'inaccuracy' ||
    resolvedQuality === 'mistake' ||
    resolvedQuality === 'blunder';
  const showCp = resolvedCpLoss > 0 && isBad;
  const phase = detectPhaseFromFen(node.fen);

  // Starting position — no coaching to show.
  if (isRoot) {
    return (
      <div className="rounded border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Coach</h2>
        Navigate to a move to see feedback.
      </div>
    );
  }

  // No analysis data at all (unanalyzed imported game).
  if (
    resolvedQuality === null &&
    node.evalCp === null &&
    node.mate === null
  ) {
    return (
      <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Coach</h2>
        <p className="text-xs text-slate-400">Not yet analyzed.</p>
      </div>
    );
  }

  // Header label differs for human vs opponent moves.
  const headerLabel = isHumanMove ? 'Coach' : 'Opponent';

  // Build the prose.
  let prose: React.ReactNode;
  if (isHumanMove) {
    if (coachText) {
      prose = <p className="text-sm leading-relaxed text-slate-200">{coachText}</p>;
    } else if (isBad && bestMoveBeforeUci) {
      prose = (
        <p className="text-sm leading-relaxed text-slate-400">
          Better was{' '}
          <span className="font-mono text-emerald-300">{bestMoveBeforeUci}</span>.
        </p>
      );
    } else if (resolvedQuality && !isBad) {
      prose = <p className="text-sm leading-relaxed text-slate-400">Good move.</p>;
    } else {
      prose = <p className="text-sm leading-relaxed text-slate-400">{'\u2014'}</p>;
    }
  } else {
    // Opponent move — explain their motives.
    const explanation = describeOpponentMove(prevNode, node, resolvedQuality, resolvedCpLoss);
    prose = <p className="text-sm leading-relaxed text-slate-200">{explanation}</p>;
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{headerLabel}</h2>
        <div className="flex items-center gap-2">
          {resolvedQuality && phase && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              {phase}
            </span>
          )}
          {isHumanMove && coachSource && (
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {coachSource}
            </span>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Quality badge */}
        {resolvedQuality && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${QUALITY_COLORS[resolvedQuality]}`}
          >
            {QUALITY_LABELS[resolvedQuality]}
            {showCp && (
              <span className="ml-1 font-normal opacity-80">
                {'\u00B7'} {(Math.abs(resolvedCpLoss) / 100).toFixed(1)} pawns
              </span>
            )}
          </span>
        )}

        {/* Motif chips */}
        {motifs.map((m) => (
          <span
            key={m}
            className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
            title={MOTIF_LABELS[m as MotifId] ?? m}
          >
            {MOTIF_LABELS[m as MotifId] ?? m}
          </span>
        ))}
      </div>

      {prose}
    </div>
  );
}
