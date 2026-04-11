# Chesster

A browser-based chess learning app. Play Stockfish. Get real-time per-move coaching. When the coach suggests a better move, **fork** into an alternate reality where you played it — explore, play it out, then **return** to your main game right where you left off. Every mistake feeds a persistent weakness profile that personalizes future coaching and builds a spaced-repetition deck of drills from your own blunders.

**LLM is optional (BYOK-only by default).** Chesster runs fully offline with rule-based coaching and hand-authored templates. Users who want Claude-generated prose can paste their own `ANTHROPIC_API_KEY` in Settings — the key lives in their browser, is sent to our serverless proxy on a per-request header, used once, and discarded. No server-funded shared quota is enabled in v1. Every structural feature (play, forking, weakness tracking, drills, dashboards, sync) works in both modes.

For the full architecture and phase-by-phase TODO checklists see [`DESIGN.md`](./DESIGN.md).

## Status

Phase 1 complete ✓ — a playable two-player chess board in the browser. Phase 1.5 (repository flattening) and Phase 2 (Stockfish opponent) are next. See the TODO checklists in [`DESIGN.md`](./DESIGN.md#15-build-phases--todo-checklists) for the full roadmap.

## Requirements

- Node.js 20+
- npm 10+
- (Optional, for full stack local dev) [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- (Optional, for sync) a [Supabase](https://supabase.com) project

## Hosting

Chesster is designed to be deployed as **a single Vercel project**:

- The Vite build (`npm run build`) produces a static `dist/` that Vercel serves from the edge.
- Anything under `api/` at the repo root becomes a Node 20 serverless function automatically.
- Auth + database are [Supabase](https://supabase.com) (managed Postgres with Row-Level Security + JWT auth).
- There is no separate backend service, no Redis, no Railway, no Neon. The stack is deliberately just Vercel + Supabase.

**To deploy:**
1. Create a Vercel project pointed at this repo.
2. Create a Supabase project, apply the schema from `DESIGN.md` §12a, and enable email magic-link auth.
3. Set the environment variables below in the Vercel dashboard.
4. Push to the linked branch.

See `DESIGN.md` §12a for the full public hosting architecture.

## LLM mode

Chesster has three named LLM modes. Only the first two are active in v1.

| Mode | Status | Description |
|---|---|---|
| `off` | active | No LLM at all. All coaching comes from rule-based detectors + hand-authored templates. The default when `/api/health` fails or BYOK is unset. |
| `byok-only` | active | Users paste their own `ANTHROPIC_API_KEY` in Settings. It is stored in IndexedDB, sent as an `X-User-API-Key` header to our `/api/explain-move` and `/api/tag-move` proxy, and used exactly once per request. The key is never logged or persisted server-side. |
| `free-tier` | **deferred** | Designed in `DESIGN.md` §12a as a shared server-funded quota mode. Not enabled in v1 because it requires a persistent rate-limit store we haven't added. The feature flag path is in place; the admission check is not. |

Anonymous users with no key fall back to `off` automatically. Every structural feature still works — LLM only upgrades *prose quality*.

## Running

### Frontend only, no cloud, no LLM

```bash
npm install
npm run dev
```

Open http://localhost:5173. Everything works offline. Games, profile, and drill deck live in IndexedDB. Coach explanations come from hand-authored templates keyed by move quality, detected motif, and game phase.

> During Phase 1 the app lives under `frontend/`. Phase 1.5 flattens it to the repo root, after which the command above runs from the root directly.

### End-to-end local (frontend + `api/*` functions)

```bash
vercel dev
```

This runs the Vite dev server **and** the serverless functions in `api/` with the same routing Vercel uses in production. Use this when you're working on `api/explain-move.ts`, `api/tag-move.ts`, `api/migrate-anonymous.ts`, or anything that touches BYOK headers.

### With Supabase sync

Copy `.env.local.example` to `.env.local` and set:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Then `npm run dev` (or `vercel dev`). The login flow is a magic-link email. Anonymous games and profile from IndexedDB are migrated into Supabase on first login via a one-shot `POST /api/migrate-anonymous` using the service-role key.

## Environment variables

Set these in the Vercel dashboard (production) or `.env.local` (local). `VITE_*` vars are baked into the static build at build time; everything else is only available to serverless functions at runtime.

| Variable | Where | Required? | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Client | Yes (for auth/sync) | Supabase project URL for the browser client |
| `VITE_SUPABASE_ANON_KEY` | Client | Yes (for auth/sync) | Supabase anon key, RLS-guarded |
| `VITE_SENTRY_DSN` | Client | No | Browser error tracking |
| `SUPABASE_URL` | Server | Yes (for auth/sync) | Server-side Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes (for auth/sync) | Service-role key, used **only** by `api/migrate-anonymous.ts` |
| `ANTHROPIC_API_KEY` | Server | No | **Reserved.** Only used if the deferred `free-tier` mode is ever enabled. Leave unset for BYOK-only operation. |
| `FREE_TIER_DAILY_CAP_CENTS` | Server | No | Reserved for the deferred `free-tier` mode. `0` (or unset) means BYOK-only. |
| `SENTRY_DSN` | Server | No | Serverless-function error tracking |

**BYOK keys are never configured via env vars.** They are entered by the end user in `/settings` and live in their browser's IndexedDB only.

## Feature matrix

| Feature | LLM off / BYOK not set | LLM on (BYOK key set) |
|---|---|---|
| Play vs Stockfish | yes | yes |
| Per-move quality badges | yes | yes |
| Best-move suggestion | yes | yes |
| Coach explanation | Template prose | Claude-generated, personalized |
| Motif tagging | Rule detectors | Rules + LLM fuzzy themes |
| Fork "try this line" | yes (anon capped at 3 branches/game) | yes (anon capped at 3 branches/game) |
| Weakness profile | yes | yes |
| Adaptive coaching | Template selection biased by profile | Profile injected into prompt |
| SRS practice drills | yes | yes |
| PGN export | yes | yes |
| Runs offline (local dev) | yes | no (Claude API required) |
| Cross-device sync (when logged in) | yes | yes |

## Project layout

After Phase 1.5 the repo flattens to a single app:

```
chesster/
├── DESIGN.md        # full architecture + per-phase TODOs
├── README.md        # this file
├── package.json     # single app, no workspaces
├── vercel.json      # routes, function config
├── src/             # Vite + React + TypeScript frontend
├── public/          # static assets (stockfish.wasm lands here in Phase 2)
└── api/             # Vercel serverless functions (Node 20)
```

See [`DESIGN.md`](./DESIGN.md#3-project-structure) for the full file tree and [`DESIGN.md`](./DESIGN.md#12c-repository-flattening-phase-15) for the flattening plan.

## License

Apache 2.0. See [`LICENSE`](./LICENSE).
