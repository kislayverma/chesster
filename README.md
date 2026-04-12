# Chesster

A browser-based chess learning app. Play Stockfish. Get real-time per-move coaching. When the coach suggests a better move, **fork** into an alternate reality where you played it — explore, play it out, then **return** to your main game right where you left off. Every mistake feeds a persistent weakness profile that personalizes future coaching and builds a spaced-repetition deck of drills from your own blunders.

**LLM is optional (BYOK-only by default).** Chesster runs fully offline with rule-based coaching and hand-authored templates. Users who want Claude-generated prose can paste their own `ANTHROPIC_API_KEY` in Settings — the key lives in their browser, is sent to our serverless proxy on a per-request header, used once, and discarded. No server-funded shared quota is enabled in v1. Every structural feature (play, forking, weakness tracking, drills, dashboards, sync) works in both modes.

For the full architecture and phase-by-phase TODO checklists see [`DESIGN.md`](./DESIGN.md).

## Status

Phases 1 – 9, 12 complete. The app ships:

- Playable chess vs Stockfish (single-threaded lite, no COOP/COEP)
- Real-time per-move coaching (`best` → `blunder` quality badges + arrows)
- Inline fork-and-return (stack of exploration frames, anon cap = 3)
- Persistent weakness profile with dashboard + mistakes list
- Phase 5 routing (`NavShell` + `/`, `/dashboard`, `/mistakes`, `/settings`)
- Phase 7 BYOK LLM proxy — `/api/health`, `/api/explain-move`, `/api/tag-move` run on Vercel Edge with `@anthropic-ai/sdk`
- Phase 8 production-ready Vercel config (`vercel.json` hardened with security headers, SPA rewrites, long-cache for static assets + stockfish binaries, no-store for `/api/*`)
- Phase 6 SRS practice drills — SM-2 scheduler auto-generates flashcards from every inaccuracy/mistake/blunder. Due cards surface as a "Warm up" prompt on the Play page. `/practice` runs a drill session: board shows the pre-mistake position, player must find the engine's best move, SM-2 schedules future reviews. Cards persist in IndexedDB and sync to the Supabase `practice_cards` table when logged in
- Phase 9 Supabase auth + cross-device sync — magic-link sign-in at `/login`, one-shot anon → account migration at `/onboarding`, RLS-guarded `profiles` / `games` / `weakness_events` tables, dual-write on every local mutation, best-effort with graceful degradation when the deployment has no Supabase credentials
- Phase 12 polish — PGN export (with RAV variations), ECO opening classification with book-move tagging, promotion picker UI, 5 additional motif detectors (pin, skewer, overloaded defender, king safety drop, bad endgame trade)

Phases 10 – 11 (extended journey pages, legal/hardening) are still on the roadmap. See the TODO checklists in [`DESIGN.md`](./DESIGN.md#15-build-phases--todo-checklists).

## Requirements

- Node.js 20+
- npm 10+
- (Optional, for full stack local dev) [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- (Optional, for sync) a [Supabase](https://supabase.com) project

## Hosting

Chesster is designed to be deployed as **a single Vercel project**:

- The Vite build (`npm run build`) produces a static `dist/` that Vercel serves from the edge.
- Anything under `api/` at the repo root becomes a serverless function automatically. Phase 7 handlers run on the **Edge Runtime** (`export const config = { runtime: 'edge' }`).
- Auth + database (Phase 9) will be [Supabase](https://supabase.com). **Not required for the Phase 8 BYOK-only launch.**
- There is no separate backend service, no Redis, no Railway, no Neon.

### Deploying to Vercel (Phase 8, BYOK-only)

The Phase 8 deploy ships Phases 1 – 5, 7, and 8 together. It needs **zero external services** — just a Vercel account.

1. **Fork / push this repo** to GitHub, GitLab, or Bitbucket.
2. **Create a Vercel project** pointed at the repo. Framework preset: Vite (auto-detected from `vercel.json`). No build-command or output-directory overrides needed — `vercel.json` pins them.
3. **Environment variables:** leave everything unset for BYOK-only v1. In particular:
   - Do **not** set `ANTHROPIC_API_KEY`. The server must stay in `byok-only` mode until the rate-limited free-tier store is designed (Phase 12).
   - Optionally set `DISABLE_LLM_PROXY=1` to force `off` mode and hard-disable every `/api/*` LLM call.
4. **Deploy.** Vercel runs `npm install` (which fires the `postinstall` script that vendors the Stockfish WASM into `public/stockfish/`) then `npm run build` (= `tsc -b && vite build`). The output is `dist/` plus three Edge functions: `/api/health`, `/api/explain-move`, `/api/tag-move`.
5. **Smoke-test the public URL:**
   - `GET /` → landing on `PlayPage`, board renders, Stockfish loads from `/stockfish/stockfish-18-lite-single.js`.
   - `GET /dashboard`, `/mistakes`, `/settings` → SPA rewrites in `vercel.json` route all three to `/index.html`; `NavShell` handles them client-side.
   - `GET /api/health` → `{ "llmMode": "byok-only" }` (or `"off"` if `DISABLE_LLM_PROXY=1`). The NavShell badge reflects this within ~800 ms of page load.
   - Paste an Anthropic key in `/settings` → badge flips to **LLM: BYOK**. Play a losing move → coach panel shows a Claude-generated explanation with `source: 'llm'`. The 20 MB `SBS - 2D Chess Pack/` folder is excluded from deploys by `.vercelignore`.
6. **Observability:** `/api/*` responses are `Cache-Control: no-store`. Static assets (`/assets/*`, `/stockfish/*`) are `max-age=31536000, immutable`. Security headers (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) are applied to every response.

### Adding Supabase sync (Phase 9)

Phase 9 layers magic-link accounts + cross-device sync on top of the Phase 8 deploy. It is opt-in: a deploy without the Supabase env vars still works exactly as Phase 8 — the `NavShell` badge reads **Local only** and the login flow is hidden.

1. **Create a Supabase project.** Any free-tier project works. Copy the Project URL, the anon key, and the service-role key from the dashboard.
2. **Apply the schema.** In the SQL editor paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) and run it. It creates the `profiles`, `games`, `weakness_events`, `anon_claims`, and `practice_cards` tables with row-level-security enabled. Every policy compares `user_id` to `auth.uid()` so RLS guards every read/write except the one `anon_claims` insert that runs through the service-role function.
3. **Configure auth.** In Supabase → Authentication → URL Configuration, set the Site URL to your Vercel deploy and add `https://<your-deploy>/login` under Redirect URLs. This is the only origin magic-link emails will land on.
4. **Set Vercel env vars:**
   - Client (VITE_*, baked into the static build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   - Server (used only by `api/migrate-anonymous.ts`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is never sent to the browser.
   - Redeploy after saving — `VITE_*` vars are compile-time only.
5. **Smoke-test:**
   - The NavShell shows a **Sign in** button. Click → `/login` renders a magic-link form (or the "Sign-in unavailable" fallback if the vars didn't make it into the build).
   - Play a few anonymous games, then sign in. `/onboarding` should count your local games + weakness events and offer **Bring it with me** / **Start fresh**. Picking either path marks the `anon_claims` row so the prompt never shows again.
   - After sign-in, open a second browser on the same account — your games and profile download automatically on first load, with a **Syncing…** chip in the header while the fetch is in flight.

See `DESIGN.md` §12a for the full public hosting architecture and the Phase 9 data contracts.

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

Open http://localhost:5173. Everything works offline. Games, profile, and drill deck live in IndexedDB. Coach explanations come from hand-authored templates keyed by move quality, detected motif, and game phase. The `/api/*` endpoints are not served in plain `vite`, so the NavShell badge shows **LLM: off** until you switch to `vercel dev`.

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
| `DISABLE_LLM_PROXY` | Server | No | Set to `1` to hard-disable every `/api/*` LLM call. `/api/health` returns `{"llmMode":"off"}` and the coach falls back to templates. |
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
| Opening classification (ECO) | yes | yes |
| Promotion picker | yes | yes |
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
