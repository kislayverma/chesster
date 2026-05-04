/**
 * Game import proxy — fetches games from Chess.com or Lichess and
 * returns them as an array of { pgn, externalId, metadata } objects.
 *
 * POST /api/import-games
 * Body: { platform: 'chesscom' | 'lichess', username: string, year: number, month: number }
 *
 * This runs on Vercel Edge Runtime. It exists so the browser doesn't
 * make cross-origin requests directly to Chess.com / Lichess (avoids
 * CORS issues and gives us a single place to handle rate limits).
 */

export const config = { runtime: 'edge' };

const MAX_GAMES = 100;
const FETCH_TIMEOUT_MS = 15_000;

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface ImportRequest {
  platform: 'chesscom' | 'lichess';
  username: string;
  year: number;
  month: number;
}

interface ImportedGame {
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
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function isValidRequest(body: unknown): body is ImportRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    (b.platform === 'chesscom' || b.platform === 'lichess') &&
    typeof b.username === 'string' &&
    b.username.length >= 1 &&
    b.username.length <= 30 &&
    typeof b.year === 'number' &&
    b.year >= 2000 &&
    b.year <= 2100 &&
    typeof b.month === 'number' &&
    b.month >= 1 &&
    b.month <= 12
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------
// Chess.com
// -----------------------------------------------------------------------

interface ChessComGame {
  url?: string;
  pgn?: string;
  time_control?: string;
  end_time?: number;
  rated?: boolean;
  white?: { username?: string; rating?: number };
  black?: { username?: string; rating?: number };
}

async function fetchChessComGames(
  username: string,
  year: number,
  month: number,
): Promise<ImportedGame[]> {
  const mm = String(month).padStart(2, '0');
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${year}/${mm}`;
  const res = await fetchWithTimeout(url);

  if (res.status === 404) {
    throw new Error('Chess.com user not found or no games for this month');
  }
  if (!res.ok) {
    throw new Error(`Chess.com API error: ${res.status}`);
  }

  const data = (await res.json()) as { games?: ChessComGame[] };
  const games = data.games ?? [];

  return games
    .filter((g): g is ChessComGame & { pgn: string } => typeof g.pgn === 'string')
    .slice(0, MAX_GAMES)
    .map((g) => ({
      pgn: g.pgn,
      externalId: g.url ?? '',
      metadata: {
        whitePlayer: g.white?.username,
        blackPlayer: g.black?.username,
        whiteElo: g.white?.rating,
        blackElo: g.black?.rating,
        timeControl: g.time_control,
        playedAt: g.end_time ? g.end_time * 1000 : undefined,
      },
    }));
}

// -----------------------------------------------------------------------
// Lichess
// -----------------------------------------------------------------------

interface LichessGame {
  id?: string;
  pgn?: string;
  clock?: { initial?: number; increment?: number };
  createdAt?: number;
  players?: {
    white?: { user?: { name?: string }; rating?: number };
    black?: { user?: { name?: string }; rating?: number };
  };
}

async function fetchLichessGames(
  username: string,
  year: number,
  month: number,
): Promise<ImportedGame[]> {
  // Compute since/until timestamps for the target month.
  const since = new Date(year, month - 1, 1).getTime();
  const until = new Date(year, month, 1).getTime(); // Start of next month.

  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?since=${since}&until=${until}&pgnInJson=true&opening=true&max=${MAX_GAMES}`;

  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/x-ndjson' },
  });

  if (res.status === 404) {
    throw new Error('Lichess user not found');
  }
  if (!res.ok) {
    throw new Error(`Lichess API error: ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const results: ImportedGame[] = [];
  for (const line of lines) {
    try {
      const g = JSON.parse(line) as LichessGame;
      if (!g.pgn) continue;

      const tc = g.clock
        ? `${(g.clock.initial ?? 0) / 60}+${g.clock.increment ?? 0}`
        : undefined;

      results.push({
        pgn: g.pgn,
        externalId: g.id ?? '',
        metadata: {
          whitePlayer: g.players?.white?.user?.name,
          blackPlayer: g.players?.black?.user?.name,
          whiteElo: g.players?.white?.rating,
          blackElo: g.players?.black?.rating,
          timeControl: tc,
          playedAt: g.createdAt,
        },
      });
    } catch {
      // Skip malformed lines.
    }
  }

  return results.slice(0, MAX_GAMES);
}

// -----------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }

  if (!isValidRequest(body)) {
    return json(400, { error: 'bad_request', message: 'Invalid platform, username, year, or month.' });
  }

  try {
    const games =
      body.platform === 'chesscom'
        ? await fetchChessComGames(body.username, body.year, body.month)
        : await fetchLichessGames(body.username, body.year, body.month);

    return json(200, { games, count: games.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[import-games] ${body.platform} fetch failed:`, message);

    if (message.includes('not found')) {
      return json(404, { error: 'not_found', message });
    }
    return json(502, { error: 'upstream_error', message });
  }
}
