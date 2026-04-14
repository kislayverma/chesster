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
import { loadGame, deserializeTree } from '../game/gameStorage';
import { walkMainline } from '../game/gameTree';
import type { GameTree, MoveNode } from '../game/gameTree';
import type { PersistedGame } from '../profile/types';
import { useProfileStore } from '../profile/profileStore';
import { useAuthStore } from '../auth/authStore';
import { QUALITY_COLORS, QUALITY_LABELS } from '../game/moveClassifier';
import { MOTIF_LABELS, type MotifId } from '../tagging/motifs';
import { computeGameSummary, type GameSummary } from '../game/gameSummary';
import GameSummaryCard from '../components/GameSummaryCard';
import EvalChart from '../components/EvalChart';
import { hasLLM, withByokHeader } from '../lib/featureFlags';
import { getCurrentProfileSummary } from '../profile/profileStore';

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
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [gameId]);

  const tree: GameTree | null = useMemo(() => {
    if (!game) return null;
    return deserializeTree(game.tree);
  }, [game]);

  const mainline: MoveNode[] = useMemo(() => {
    if (!tree) return [];
    return Array.from(walkMainline(tree));
  }, [tree]);

  // Game summary — computed from mainline tree data.
  const gameSummary: GameSummary | null = useMemo(() => {
    if (!tree || !game) return null;
    return computeGameSummary(tree, game.humanColor);
  }, [tree, game]);

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

      {/* Column 2: Game info + Summary + Move list */}
      <aside className="flex flex-col gap-4">
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
              {game.engineEnabled ? 'Stockfish' : 'Human'}
            </dd>
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
