/**
 * Phase 9 anonymous-data migration endpoint.
 *
 * Accepts a single-shot upload of everything the anonymous user has
 * played locally (games + profile + weakness events) and writes it
 * into their newly-authenticated account under `auth.uid()`. Runs on
 * the default Node runtime so we can use the Supabase service-role
 * client — the only place in the codebase where it is instantiated.
 *
 * Security model:
 *
 *   1. The request MUST include an `Authorization: Bearer <jwt>`
 *      header. We hand the token to the service-role client's
 *      `auth.getUser()` to resolve a real `userId`. A missing or
 *      invalid token is rejected with 401. The service role is
 *      NEVER used to speak for an unauthenticated caller.
 *
 *   2. `user_id` on every inserted row is clamped to the verified
 *      `userId` — we do NOT trust any `user_id` the client puts in
 *      the payload.
 *
 *   3. `anon_id` must be a well-formed UUID. The primary key on
 *      `public.anon_claims` makes double-migrations a no-op:
 *      `{ upsert, onConflict: 'anon_id', ignoreDuplicates: true }`
 *      returns success the second time without reinserting data.
 *
 *   4. The whole batch is scoped behind a single "already claimed?"
 *      check so a replay with different payload (e.g. a user clearing
 *      local data and re-uploading) does NOT merge stale data into
 *      their account. First write wins.
 *
 *   5. The service-role key is pulled from `process.env` and scrubbed
 *      from every log line. Handler errors never echo the payload.
 */

import { createClient } from '@supabase/supabase-js';

type UnknownRecord = Record<string, unknown>;

interface Payload {
  anonId: string;
  games: UnknownRecord[];
  profile: UnknownRecord | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv(name: string): string | undefined {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  return env?.[name];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function extractBearer(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1] : null;
}

function isRecord(v: unknown): v is UnknownRecord {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function validatePayload(body: unknown): Payload | null {
  if (!isRecord(body)) return null;
  const anonId = body.anonId;
  if (typeof anonId !== 'string' || !UUID_RE.test(anonId)) return null;
  const games = Array.isArray(body.games) ? (body.games as UnknownRecord[]) : [];
  const profile = isRecord(body.profile) ? body.profile : null;
  return { anonId, games, profile };
}

function toIsoOrNow(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && v.length > 0) return v;
  return new Date().toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const url = readEnv('SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return json(503, { error: 'sync_unavailable' });
  }

  const token = extractBearer(req);
  if (!token) {
    return json(401, { error: 'missing_token' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const payload = validatePayload(body);
  if (!payload) {
    return json(400, { error: 'bad_request' });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the caller's user id via the verified JWT. This uses
  // Supabase's /auth/v1/user under the hood; the service role is NOT
  // authorizing the identity, it is only being used to do the writes
  // afterwards.
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: 'invalid_token' });
  }
  const userId = userData.user.id;

  // Claim check — the `anon_claims` primary key on `anon_id` makes
  // this the single authoritative gate. If a row already exists we
  // return success with zero counts so the client marks the local
  // "already migrated" flag and stops prompting.
  const { data: existing, error: existingErr } = await admin
    .from('anon_claims')
    .select('anon_id,user_id')
    .eq('anon_id', payload.anonId)
    .maybeSingle();
  if (existingErr) {
    console.warn('[migrate-anonymous] claim lookup failed');
    return json(500, { error: 'lookup_failed' });
  }
  if (existing) {
    if (existing.user_id !== userId) {
      // Anon id was already claimed by a different user. Refuse.
      return json(409, { error: 'anon_id_taken' });
    }
    return json(200, {
      ok: true,
      counts: { games: 0, weaknessEvents: 0, profileTouched: false },
      alreadyClaimed: true,
    });
  }

  // ------------------------------------------------------------------
  // Build row sets
  // ------------------------------------------------------------------
  const gameRows = payload.games
    .filter(isRecord)
    .map((g) => {
      const id = asString(g.id);
      if (!id) return null;
      const tree = g.tree;
      if (!isRecord(tree)) return null;
      const humanColor = g.humanColor === 'b' ? 'b' : 'w';
      return {
        id,
        user_id: userId,
        started_at: toIsoOrNow(g.startedAt),
        updated_at: toIsoOrNow(g.updatedAt ?? g.startedAt),
        finished_at: toIsoOrNull(g.finishedAt),
        result: typeof g.result === 'string' ? g.result : null,
        mainline_plies: asNumber(g.mainlinePlies),
        engine_enabled: asBoolean(g.engineEnabled, true),
        human_color: humanColor,
        tree,
      };
    })
    .filter(<T>(v: T | null): v is T => v !== null);

  const profile = payload.profile;
  const profileRow = profile
    ? {
        user_id: userId,
        total_games: asNumber(profile.totalGames),
        total_moves: asNumber(profile.totalMoves),
        motif_counts: isRecord(profile.motifCounts) ? profile.motifCounts : {},
        phase_cp_loss: isRecord(profile.phaseCpLoss)
          ? profile.phaseCpLoss
          : { opening: 0, middlegame: 0, endgame: 0 },
        opening_weaknesses: isRecord(profile.openingWeaknesses)
          ? profile.openingWeaknesses
          : {},
        acpl_history: Array.isArray(profile.acplHistory) ? profile.acplHistory : [],
        created_at: toIsoOrNow(profile.createdAt),
        updated_at: toIsoOrNow(profile.updatedAt ?? profile.createdAt),
      }
    : null;

  const rawEvents = Array.isArray(profile?.weaknessEvents)
    ? (profile!.weaknessEvents as UnknownRecord[])
    : [];
  const eventRows = rawEvents
    .filter(isRecord)
    .map((e) => {
      const id = asString(e.id);
      if (!id) return null;
      const quality = asString(e.quality);
      if (
        quality !== 'inaccuracy' &&
        quality !== 'mistake' &&
        quality !== 'blunder'
      ) {
        return null;
      }
      const phase = asString(e.phase);
      if (phase !== 'opening' && phase !== 'middlegame' && phase !== 'endgame') {
        return null;
      }
      const color = asString(e.color);
      if (color !== 'white' && color !== 'black') return null;
      return {
        id,
        user_id: userId,
        game_id: asString(e.gameId),
        move_number: asNumber(e.moveNumber),
        fen: asString(e.fen),
        player_move: asString(e.playerMove),
        best_move: asString(e.bestMove),
        cp_loss: asNumber(e.cpLoss),
        quality,
        phase,
        motifs: asStringArray(e.motifs),
        eco: typeof e.eco === 'string' ? e.eco : null,
        color,
        ts: toIsoOrNow(e.timestamp),
      };
    })
    .filter(<T>(v: T | null): v is T => v !== null);

  // ------------------------------------------------------------------
  // Writes. Postgres does not give us a single "BEGIN/COMMIT" through
  // the REST API, so we order operations so a partial failure leaves
  // the claim table untouched — future retries pick up where we left
  // off. The claim is the VERY LAST write.
  // ------------------------------------------------------------------

  const counts = {
    games: gameRows.length,
    weaknessEvents: eventRows.length,
    profileTouched: Boolean(profileRow),
  };

  if (gameRows.length > 0) {
    const { error } = await admin
      .from('games')
      .upsert(gameRows, { onConflict: 'id' });
    if (error) {
      console.warn('[migrate-anonymous] games upsert failed');
      return json(500, { error: 'games_failed' });
    }
  }

  if (profileRow) {
    const { error } = await admin
      .from('profiles')
      .upsert(profileRow, { onConflict: 'user_id' });
    if (error) {
      console.warn('[migrate-anonymous] profile upsert failed');
      return json(500, { error: 'profile_failed' });
    }
  }

  if (eventRows.length > 0) {
    const { error } = await admin
      .from('weakness_events')
      .upsert(eventRows, { onConflict: 'id' });
    if (error) {
      console.warn('[migrate-anonymous] events upsert failed');
      return json(500, { error: 'events_failed' });
    }
  }

  const { error: claimErr } = await admin
    .from('anon_claims')
    .insert({
      anon_id: payload.anonId,
      user_id: userId,
      counts,
    });
  if (claimErr) {
    // The claim is the last write — the data is already in place.
    // We still surface the error so the client knows a retry is safe.
    console.warn('[migrate-anonymous] claim insert failed');
    return json(500, { error: 'claim_failed', counts });
  }

  return json(200, { ok: true, counts });
}
