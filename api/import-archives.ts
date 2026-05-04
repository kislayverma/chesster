/**
 * Chess.com archive listing proxy.
 *
 * GET /api/import-archives?platform=chesscom&username=<username>
 *
 * Returns the list of available year/month pairs for a Chess.com user.
 * Lichess doesn't need this — it uses since/until timestamps directly.
 */

export const config = { runtime: 'edge' };

const FETCH_TIMEOUT_MS = 10_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return json(405, { error: 'method_not_allowed' });
  }

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const username = searchParams.get('username');

  if (platform !== 'chesscom') {
    return json(400, { error: 'bad_request', message: 'Only chesscom platform supports archive listing.' });
  }
  if (!username || username.length < 1 || username.length > 30) {
    return json(400, { error: 'bad_request', message: 'Invalid username.' });
  }

  try {
    const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
    const res = await fetchWithTimeout(url);

    if (res.status === 404) {
      return json(404, { error: 'not_found', message: 'Chess.com user not found.' });
    }
    if (!res.ok) {
      return json(502, { error: 'upstream_error', message: `Chess.com API error: ${res.status}` });
    }

    const data = (await res.json()) as { archives?: string[] };
    const archiveUrls = data.archives ?? [];

    // Parse URLs like "https://api.chess.com/pub/player/foo/games/2024/03"
    const archives = archiveUrls
      .map((u) => {
        const match = u.match(/\/games\/(\d{4})\/(\d{2})$/);
        if (!match) return null;
        return { year: parseInt(match[1], 10), month: parseInt(match[2], 10) };
      })
      .filter((a): a is { year: number; month: number } => a !== null)
      .sort((a, b) => b.year - a.year || b.month - a.month); // Most recent first.

    return json(200, { archives });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.warn('[import-archives] fetch failed:', message);
    return json(502, { error: 'upstream_error', message });
  }
}
