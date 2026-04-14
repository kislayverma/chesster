# altmove — Design Document

> **Status:** Phase 5 complete ✓ — persistent player profile (`src/profile/{types,profileAggregates,weaknessSelector,profileStore}.ts`) with exponential-decay motif counts (`HALFLIFE_MS = 14d`) + `getTopWeaknesses` + localforage persistence, WeaknessEvents now appended on every human inaccuracy/mistake/blunder inside `kickAnalysis`, game trees persisted via `src/game/gameStorage.ts` (keyed by tree id, with a lightweight `chesster:games:index`), coach template layer biased by `profileSummary.topMotifs` with a "recurring weakness" reinforcement suffix when decayed count ≥ 3, new `WeaknessDashboard` (CSS bar graphs + SVG sparkline, no chart lib) embedded in `DashboardPage`, flat `MistakesPage` with motif + phase filters, `NavShell` header with Play/Dashboard/Mistakes nav links, and `react-router-dom` routing wired through `BrowserRouter` in `main.tsx`. `tsc -b` and `npm run build` clean (107 modules, 394.40 kB / 122.84 kB gzipped). Phase 6 (SRS practice) is next. This doc contains the full architecture **and** a per-phase TODO checklist. You can resume work at any time by reading the checklists in §15.

---

## 1. Overview

altmove is a browser-based chess learning application. The player plays a full game against Stockfish, and after every move a coach explains how good or bad the move was and what the engine's preferred move would have been.

The two distinguishing features are:

1. **Inline fork-and-return.** At any point the player can accept the coach's suggestion and "try that line instead." The game forks into an alternate reality where the suggested move is played, the player continues playing from there, and when they are done exploring they return to the main game at the exact point they left off. Nothing is lost — every fork is stored in the game tree and is revisitable.

2. **Adaptive coaching across games.** Every mistake feeds a persistent player profile tagged by motif, phase, and opening. The coach uses this profile to prioritize what to teach, and the app builds a spaced-repetition deck of drills from the player's own blunders.

### LLM is optional — default is BYOK

altmove works fully offline with zero external dependencies. The default LLM mode is **`byok-only`**: coaching upgrades to Claude-generated prose only for users who paste their own `ANTHROPIC_API_KEY` in Settings. Anonymous and logged-in users without a key get deterministic rule-based detectors + hand-authored templates. **Every user-visible feature works in both modes.** LLM mode only upgrades *quality*, not *capability*.

A shared `free-tier` mode (server-funded quota) is designed in §12a but **deferred** — it would require a rate-limit store we are not adding yet.

### Public hosting

altmove is designed to be deployed as a single public web app. The whole thing — static frontend + serverless functions + auth + database — runs on **Vercel + Supabase**, with the frontend also runnable standalone for local development without any cloud dependency. Login is optional: anonymous users get a fully working local-only experience; logging in migrates their local data server-side and enables cross-device sync. Anonymous users are capped at **3 parallel exploration timelines** per game to limit abuse of the browser-only state.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Build / framework | Vite + React 18 + TypeScript | Fast dev loop; Vite output is static, perfect for Vercel's edge |
| Routing | `react-router-dom` v6 | Client-side routes for the multi-page app (§3a) |
| Styling | Tailwind CSS | Low-ceremony styling |
| Charts | `recharts` | Dashboard (top motifs, ACPL over time, phase breakdown) |
| Utilities | `clsx`, `date-fns` | Class composition; date formatting for history |
| State | Zustand | Lightweight store, fits the tree-based game state |
| Local persistence | `localforage` (IndexedDB) | Anonymous-mode game store, practice deck, profile |
| Chess logic | `chess.js` | Move validation, FEN/PGN, legal moves |
| Board UI | `react-chessboard` | React-native API, drag/drop, arrows, highlights |
| Engine | `stockfish.wasm` in a Web Worker | World-class strength, runs entirely in the browser, UCI protocol |
| Server runtime | Vercel Serverless Functions (Node 20) | Single-deployment hosting; no separate backend box |
| Auth + DB | Supabase (Auth + Postgres + Row-Level Security) | Managed Postgres with built-in JWT auth and per-row access rules |
| LLM SDK | `@anthropic-ai/sdk` | Ephemeral client per request; key is either server env (`free-tier`, deferred) or the user's own header (`byok-only`) |
| Server cache | `lru-cache` (in-memory, per function instance) | Zero new infra; opportunistic. No Redis, no Upstash. |
| Error tracking | Sentry (optional) | Off by default; enabled via env |

**Explicitly not used:** Express, Railway, Neon, Redis, Upstash, Better Auth, Cloudflare Turnstile, Next.js. Each was considered during planning and dropped in favor of the simpler Vercel + Supabase + in-memory stack.

---

## 3. Project Structure

```
altmove/
├── DESIGN.md
├── README.md
├── .gitignore
├── package.json                    # single app, no workspaces (after Phase 1.5)
├── vercel.json                     # routes, function config
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
│
├── public/
│   └── stockfish/                  # stockfish.wasm + loader (vendored in Phase 2)
│
├── src/                            # frontend app
│   ├── main.tsx
│   ├── App.tsx                     # <RouterProvider> root
│   ├── routes.tsx                  # route table (§3a)
│   ├── index.css
│   │
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── PlayPage.tsx            # live game + coach panel + fork UI
│   │   ├── LibraryPage.tsx         # saved games list
│   │   ├── GameReviewPage.tsx      # read-only replay of a finished game
│   │   ├── DashboardPage.tsx       # weakness profile charts
│   │   ├── MistakesPage.tsx        # flat list of WeaknessEvents with filters
│   │   ├── PracticePage.tsx        # SRS drills
│   │   ├── ProfilePage.tsx
│   │   ├── SettingsPage.tsx        # BYOK key input, engine depth, LLM toggle
│   │   ├── LoginPage.tsx
│   │   ├── OnboardingPage.tsx
│   │   ├── PrivacyPage.tsx
│   │   └── TermsPage.tsx
│   │
│   ├── components/
│   │   ├── Board.tsx               # react-chessboard wrapper
│   │   ├── EvalBar.tsx             # live engine eval
│   │   ├── MoveList.tsx            # mainline + variation tree
│   │   ├── CoachPanel.tsx          # badge + explanation + "try this line"
│   │   ├── ForkBanner.tsx          # "Exploration mode — Return"
│   │   ├── WeaknessDashboard.tsx   # charts
│   │   ├── PracticeDrawer.tsx      # SRS warmup puzzles
│   │   ├── SettingsPanel.tsx       # engine depth, skill, BYOK key, LLM toggle
│   │   └── NavShell.tsx            # top nav + sidebar scaffolding
│   │
│   ├── engine/
│   │   ├── stockfishWorker.ts      # web worker bootstrap
│   │   └── analysis.ts             # analyzePosition(fen) API
│   │
│   ├── game/
│   │   ├── gameTree.ts             # MoveNode tree + operations
│   │   ├── gameStore.ts            # Zustand store for active game
│   │   ├── moveClassifier.ts       # cpLoss → quality
│   │   └── pgn.ts                  # export with variations
│   │
│   ├── coach/
│   │   ├── coachClient.ts          # decides LLM vs. fallback
│   │   ├── templates.ts            # hand-authored fallback prose
│   │   ├── motifPhrases.ts         # short per-motif snippets
│   │   └── types.ts                # CoachRequest / CoachResponse
│   │
│   ├── tagging/
│   │   ├── motifs.ts               # fixed motif vocabulary
│   │   ├── ruleDetectors.ts        # hanging piece, fork, pin, etc.
│   │   ├── phaseDetector.ts        # opening/middle/endgame
│   │   ├── ecoLookup.ts            # FEN → opening code
│   │   └── tagMove.ts              # orchestrator
│   │
│   ├── profile/
│   │   ├── profileStore.ts         # Zustand + localforage persistence
│   │   ├── profileAggregates.ts    # rollups with exponential recency decay
│   │   ├── weaknessSelector.ts     # top-N weaknesses for prompt/selection
│   │   └── types.ts
│   │
│   ├── srs/
│   │   ├── scheduler.ts            # SM-2 implementation
│   │   ├── practiceStore.ts        # due cards, results
│   │   └── types.ts
│   │
│   ├── sync/
│   │   ├── supabaseClient.ts       # anon-key browser client
│   │   ├── remoteGameStore.ts      # logged-in users: games go here
│   │   ├── remoteProfileStore.ts   # logged-in users: profile + events
│   │   └── migrateAnonymous.ts     # one-shot local → server upload on login
│   │
│   └── lib/
│       ├── featureFlags.ts         # LLM mode detection, feature toggles
│       ├── byokStorage.ts          # read/write the user's API key in IndexedDB
│       ├── anonId.ts               # stable UUID for anonymous device
│       ├── branchLimit.ts          # countExplorationBranches(tree)
│       └── hash.ts                 # sha256 for cache keys
│
└── api/                            # Vercel serverless functions (Node 20)
    ├── health.ts                   # GET — returns { llmMode }
    ├── explain-move.ts             # POST — Claude coaching proxy
    ├── tag-move.ts                 # POST — Claude motif tagger
    ├── migrate-anonymous.ts        # POST — server-side transaction for login migration
    └── _lib/
        ├── anthropicClient.ts      # builds a one-shot client from byok header or env
        ├── cache.ts                # module-level lru-cache instance
        ├── supabaseAdmin.ts        # service-role client (admin ops only)
        └── prompts/
            ├── explain.ts
            └── tag.ts
```

**Why this layout:** the root is a single Vite app, so `npm run dev` just works. Vercel detects `api/` and deploys every file there as a serverless function automatically. No monorepo, no workspaces, no multi-package coordination. (Phase 1 started as a `frontend/` workspace; Phase 1.5 flattens it — see §12c.)

### 3a. Screens & Navigation

altmove is not just a game page — it's a small multi-page app. All routes are client-side except auth callbacks.

| Route | Page | Auth | Purpose |
|---|---|---|---|
| `/` | `HomePage` | optional | Landing: "Play now" CTA, feature pitch, links to library/dashboard |
| `/play` | `PlayPage` | optional | Live game vs Stockfish + coach panel + fork UI |
| `/play/:gameId` | `PlayPage` | optional | Resume a specific saved game (local for anon, Supabase for logged-in) |
| `/library` | `LibraryPage` | optional | Saved games list; click to open in read-only review or resume |
| `/library/:gameId` | `GameReviewPage` | optional | Read-only PGN replay with coach comments and evals |
| `/dashboard` | `DashboardPage` | optional | Weakness profile charts: top motifs, ACPL, phase breakdown |
| `/mistakes` | `MistakesPage` | optional | Flat list of `WeaknessEvent`s with filters (motif, phase, opening) |
| `/practice` | `PracticePage` | optional | SRS drill runner; cards sourced from the profile |
| `/profile` | `ProfilePage` | logged-in | Account info, stats rollup, sign out |
| `/settings` | `SettingsPage` | optional | BYOK key input, engine depth/skill, coaching verbosity, data export/clear |
| `/login` | `LoginPage` | no | Email magic link via Supabase Auth |
| `/onboarding` | `OnboardingPage` | logged-in | One-time welcome + local → server migration prompt |
| `/privacy` | `PrivacyPage` | no | Privacy policy |
| `/terms` | `TermsPage` | no | Terms of service |

**Anonymous users** see every page except `/profile` and `/onboarding`; their data lives in IndexedDB and is stamped with a client-generated UUID (`lib/anonId.ts`). Logging in triggers a one-shot `POST /api/migrate-anonymous` that transfers everything under their new user id (§12a).

`NavShell.tsx` wraps every page and renders: logo → Play / Library / Dashboard / Practice / Settings → LLM mode badge → account menu. Auth-gated pages redirect to `/login` with a `?next=` query param.

---

## 4. Core Data Model

### 4.1 Game tree (for forking)

```ts
type MoveQuality =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'book';

interface MoveNode {
  id: string;                    // uuid
  parentId: string | null;       // null only for the root
  move: string | null;           // SAN; null for root
  fen: string;                   // position AFTER this move
  evalCp: number | null;         // centipawn eval from white's perspective
  mate: number | null;           // mate-in-N if applicable
  quality?: MoveQuality;
  coachComment?: string;         // filled by LLM or template
  coachSource?: 'llm' | 'template';
  motifs?: string[];             // from tagging pipeline
  childrenIds: string[];         // first child = mainline continuation
  isExploration: boolean;        // true if inside a fork
}

interface GameState {
  id: string;
  nodes: Map<string, MoveNode>;
  rootId: string;
  currentNodeId: string;           // where the board is currently rendered
  mainGameHeadId: string;          // tip of the real game (Return jumps here)
  explorationRootId: string | null; // set while in a fork
  result?: '1-0' | '0-1' | '1/2-1/2';
  startedAt: number;
}
```

**Invariants:**
- The main game is a single path from root to `mainGameHeadId`. Along this path every node has `isExploration = false`.
- Exploration subtrees are rooted at a sibling of a main-game node; every node inside has `isExploration = true`.
- `currentNodeId` is the only source of truth for which position the board renders.
- Nothing is ever deleted — variations accumulate.

### 4.2 Player profile (for adaptive coaching)

```ts
interface WeaknessEvent {
  id: string;
  gameId: string;
  moveNumber: number;
  fen: string;                   // position BEFORE the mistake
  playerMove: string;            // SAN
  bestMove: string;              // SAN
  cpLoss: number;
  quality: MoveQuality;          // always inaccuracy | mistake | blunder
  phase: 'opening' | 'middlegame' | 'endgame';
  motifs: string[];
  eco?: string;
  color: 'white' | 'black';
  timestamp: number;
}

interface PlayerProfile {
  totalGames: number;
  totalMoves: number;
  weaknessEvents: WeaknessEvent[];   // append-only log
  motifCounts: Record<
    string,
    { count: number; decayedCount: number; cpLossTotal: number; lastSeen: number }
  >;
  phaseCpLoss: { opening: number; middlegame: number; endgame: number };
  openingWeaknesses: Record<string, { games: number; avgCpLoss: number }>;
  acplHistory: { timestamp: number; acpl: number }[];
  createdAt: number;
  updatedAt: number;
}
```

Aggregates use **exponential recency decay** so old events fade:
```
decayedCount = Σ exp(-(now - event.timestamp) / HALFLIFE_MS)
```
This makes the weakness profile reflect *current* weaknesses, not lifetime ones.

### 4.3 SRS practice

```ts
interface PracticeCard {
  id: string;
  eventId: string;               // link back to the WeaknessEvent
  fen: string;                   // position BEFORE the player's move
  bestMove: string;              // SAN — the answer
  motifs: string[];
  easeFactor: number;            // SM-2
  intervalDays: number;
  dueAt: number;
  lapses: number;
}
```

---

## 5. Move Classification

```
cpLoss ≤ 10   → best
cpLoss ≤ 25   → excellent
cpLoss ≤ 50   → good
cpLoss ≤ 100  → inaccuracy
cpLoss ≤ 200  → mistake
cpLoss > 200  → blunder
```

Where `cpLoss = evalBeforeMove − evalAfterMove`, normalized to the moving side's perspective.

Special cases:
- Positions with only one legal move skip classification.
- A move that loses a forced mate is always `blunder`.
- Moves matched against an ECO opening book are labeled `book` (Phase 12 polish).

---

## 6. LLM-Optional Contract

This is the architectural backbone that makes the LLM truly optional.

```ts
// lib/featureFlags.ts
// Probes GET /api/health once on startup with a short timeout, and
// also reads the current BYOK key from IndexedDB. Returns the effective mode.
type LlmMode = 'off' | 'byok-only' | 'free-tier';
async function getLlmMode(): Promise<LlmMode>;
function hasLLM(): boolean;   // true when byok-only (with key) or free-tier available

// coach/types.ts
interface CoachRequest {
  fenBefore: string;
  playerMove: string;
  bestMove: string;
  pv: string[];
  quality: MoveQuality;
  cpLoss: number;
  motifs: string[];
  profileSummary?: ProfileSummary;   // injected for personalization
}

interface CoachResponse {
  text: string;
  source: 'llm' | 'template';
}

// coach/coachClient.ts
async function getCoachExplanation(req: CoachRequest): Promise<CoachResponse> {
  if (hasLLM()) {
    try {
      const res = await fetch('/api/explain-move', {
        method: 'POST',
        headers: withByokHeader({ 'content-type': 'application/json' }),
        body: JSON.stringify(req),
      });
      if (res.ok) {
        const { explanation } = await res.json();
        return { text: explanation, source: 'llm' };
      }
    } catch {
      // fall through to template on any failure
    }
  }
  return { text: renderTemplate(req), source: 'template' };
}
```

The same pattern applies to tagging:

```ts
// tagging/tagMove.ts
async function tagMove(ctx: TagContext): Promise<string[]> {
  const ruleTags = runRuleDetectors(ctx);           // always runs
  if (ctx.quality === 'best' || ctx.quality === 'good') return ruleTags;
  if (!hasLLM()) return ruleTags;
  try {
    const { motifs } = await fetch('/api/tag-move', {
      method: 'POST',
      headers: withByokHeader({ 'content-type': 'application/json' }),
      body: JSON.stringify(ctx),
    }).then(r => r.json());
    return dedupe([...ruleTags, ...motifs]);        // LLM augments, never replaces
  } catch {
    return ruleTags;
  }
}
```

**Key properties:**
- LLM is never in the game's hot path — explanations arrive asynchronously.
- Any LLM failure silently falls back to templates/rules. No user-visible error.
- A header badge displays the current mode (`LLM: off` / `LLM: byok`).
- In BYOK mode the key is read from IndexedDB and sent as `X-User-API-Key` on every LLM call. The server uses it for that one request and forgets it. It is never logged, never persisted server-side, and never sent to any origin except `/api/*` (same-origin).

---

## 7. Rule-Based Motif Detectors

Implemented in `src/tagging/ruleDetectors.ts`. Each is a pure function over `(fenBefore, playerMove, bestMove, pv, chessInstance)`.

**Phase 3 initial set:**
1. `hanging_piece` — opponent's best reply after the player's move captures an undefended piece.
2. `missed_capture` — a free piece existed before the move and wasn't taken.
3. `missed_fork` — `bestMove` attacks 2+ valuable targets; `playerMove` doesn't.
4. `back_rank_weakness` — king on back rank with no luft; `bestMove` exploits/defends.
5. `missed_mate` — `bestMove` has `mate > 0`, `playerMove` doesn't.

**Later additions (Phase 12 polish):**
- `missed_pin`, `missed_skewer`, `overloaded_defender`, `king_safety_drop`, `trade_into_bad_endgame`.

**Vocabulary is versioned.** `src/tagging/motifs.ts` exports `MOTIF_VOCAB_VERSION` — any change bumps it and historical aggregates can be recomputed from the event log.

---

## 8. Per-Move Flow

Same in both modes. LLM calls are concurrent with engine analysis and never block move playback.

1. User drops a piece → `chess.js` validates.
2. New `MoveNode` inserted; `currentNodeId` updated; move list re-renders immediately.
3. Stockfish analyzes the new position → `{ evalAfter, bestMove, pv, mate }`.
4. `moveClassifier` computes `cpLoss` and assigns `quality`.
5. `tagMove(ctx)` runs → motifs attached to the node.
6. If `quality ∈ {inaccuracy, mistake, blunder}`:
   - A `WeaknessEvent` is appended to `profileStore`.
   - Aggregates are recomputed (debounced).
7. `getCoachExplanation(req)` — returns LLM prose or a template; stored on the node and rendered in `CoachPanel`.
8. Engine plays its reply at the configured skill level. Loop.

---

## 9. Fork Flow — "Try This Line"

1. User clicks **"Try `bestMove` instead"** in the `CoachPanel`.
2. Before forking, `gameStore.tryThisLine()` calls `countExplorationBranches(tree)`. If the viewer is anonymous **and** the count is already `≥ MAX_ANON_BRANCHES` (§12b), the button shows a toast ("Log in to keep exploring — anonymous users get 3 branches per game") and the fork is refused.
3. Otherwise `gameStore` finds the **parent** of the current node (position before the mistake).
4. A new `MoveNode` is inserted as a second child of that parent with the engine's best move and `isExploration = true`.
5. `currentNodeId` → new node; `explorationRootId` → new node.
6. A yellow `ForkBanner` appears with a **Return to main game** button.
7. Player continues. Every move inherits `isExploration = true`. Full coaching runs in the fork.
8. **Return** sets `currentNodeId = mainGameHeadId` and clears `explorationRootId`. The fork subtree stays in the tree and is visible in `MoveList`.
9. Nested forks are allowed — each still counts as one branch from its root in the anon-limit accounting.

---

## 10. Weakness Profile & Adaptive Coaching

**Tagging** (§7) turns every mistake/blunder into a `WeaknessEvent`.

**Aggregation** runs on a debounce:
- `motifCounts[m].decayedCount = Σ exp(-(now - e.timestamp) / HALFLIFE)` for events tagged with motif `m`.
- `phaseCpLoss[phase]` = rolling average over last K events.
- `openingWeaknesses[eco]` = games + avg cpLoss per opening.
- `acplHistory` appended once per finished game.

**`getTopWeaknesses(profile, n)`** → top `n` motifs by `decayedCount`, filtered to `count >= MIN_COUNT`.

**Adaptive coaching uses the profile in two ways:**

1. **Prioritization (both modes).** When a move's motifs intersect `topWeaknesses`, the coach panel expands and draws more attention. Motifs the player has mastered (high lifetime count, zero recent) are suppressed to avoid nagging.

2. **Personalization.**
   - **LLM mode:** `profileSummary` is injected into the explain prompt. Example:
     > "The student's top recurring weaknesses: (1) hanging pieces (9/20 recent games), (2) missed knight forks, (3) poor king safety in the Sicilian as black. If this move relates to any of these, explicitly connect the feedback to the pattern."
   - **Template mode:** `renderTemplate` is passed the top weaknesses and prefers templates whose `motifs` field matches. Templates can also include an optional `reinforcementSuffix` such as *"This is the 3rd time this week — keep practicing."* which is appended when `count >= 3` for that motif.

**Dashboard (`DashboardPage.tsx` + `WeaknessDashboard.tsx`):** top motifs bar chart, ACPL over time, phase breakdown, and "retired weaknesses" (motifs whose decayed count has dropped below threshold).

---

## 11. Spaced-Repetition Practice (No LLM Required)

`src/srs/scheduler.ts` implements SM-2. Every `WeaknessEvent` spawns a `PracticeCard` that lives in `practiceStore` (localforage for anon, Supabase table for logged-in).

**Flow:**
- At session start, `getDueCards(limit)` returns the cards due today.
- `PracticeDrawer.tsx` shows one card at a time: the board renders `card.fen`, the player drags their answer.
- Compare against `card.bestMove`:
  - Correct → SM-2 bumps `intervalDays` and `easeFactor`, updates `dueAt`.
  - Incorrect → `intervalDays = 1`, `easeFactor` reduced, `lapses++`.
- Results persisted to `practiceStore`.

This system needs no LLM and no backend logic beyond persistence. It is entirely deterministic and works offline.

---

## 12. Server Surface (Optional — BYOK proxy + sync)

**Always-mounted function:**
- `GET /api/health` → `{ llmMode: 'off' | 'byok-only' | 'free-tier' }`

**BYOK-gated functions:**
- `POST /api/explain-move` — validates the `X-User-API-Key` header, builds an ephemeral `@anthropic-ai/sdk` client, calls `claude-sonnet-4-5-20250929` with max 300 tokens, returns `{ explanation }`. Cache key = `sha256(fen + move + profileHash)`. Cache is module-level `lru-cache` per warm function instance.
- `POST /api/tag-move` — same pattern, constrained JSON output over the fixed motif vocabulary, cache key = `sha256(fen + move)`.

**Auth/sync functions:**
- `POST /api/migrate-anonymous` — service-role Supabase call that moves rows for an anonymous device UUID over to a freshly-authenticated user id in a single transaction. Called once on first login.

**Frontend probe:** `getLlmMode()` calls `GET /api/health` once on startup with a ~500 ms timeout. On failure, mode is forced to `off` for the session.

### 12a. Public Hosting Architecture

**Topology:**
```
            ┌────────────────────────────────────────┐
            │  Vercel edge (single deployment)        │
            │                                         │
  Browser ──┤   /                  → static Vite build│
            │   /play, /dashboard  → static Vite build│
            │   /api/*             → Node 20 functions│
            │                                         │
            └──────────┬────────────┬─────────────────┘
                       │            │
                       │            └──── Anthropic API
                       │                  (ephemeral client,
                       │                   key from BYOK header
                       │                   or server env)
                       ▼
               ┌───────────────┐
               │   Supabase    │
               │  • Auth (JWT) │
               │  • Postgres   │
               │  • RLS        │
               └───────────────┘
```

**Why this shape:**
- One deployment, one `vercel.json`, one domain. `npm run build` produces a static `dist/`, and anything in `api/` is auto-detected and deployed as a serverless function.
- The frontend talks to Supabase directly using the **anon** key and `VITE_SUPABASE_URL`. Row-Level Security enforces per-user access — nothing sensitive is proxied through our functions just to reach the DB.
- The server only exists for things that *must* be server-side: the LLM proxy (so the user's key doesn't live in CORS-hostile client code) and the anonymous-migration transaction (which needs service-role privileges).

**Supabase schema (Phase 9):**
```
users                 (managed by Supabase Auth)
profiles              (user_id PK, created_at, motif_counts jsonb, phase_cp_loss jsonb, ...)
games                 (id PK, owner uuid, started_at, result, pgn, tree jsonb)
weakness_events       (id PK, user_id, game_id, fen, player_move, best_move, cp_loss, quality, phase, motifs text[], eco, color, ts)
practice_cards        (id PK, user_id, event_id, fen, best_move, ease_factor, interval_days, due_at, lapses)
anon_claims           (anon_id uuid, user_id uuid, claimed_at)   -- audit of migrations
```

Every table with a `user_id` has an RLS policy of the form `user_id = auth.uid()`. The service-role key (server-only, never shipped) is used only by `api/migrate-anonymous.ts` to rewrite `user_id` on a batch of anon-tagged rows under one transaction.

**LLM mode table:**

| Mode | Who uses it | Key source | Rate limit |
|---|---|---|---|
| `off` | Everyone when `/api/health` reports off | — | — |
| `byok-only` | **Default.** Users who paste a key in Settings. | `X-User-API-Key` header (read from IndexedDB in browser; discarded after the one request on the server) | Users pay Anthropic directly; no server-side quota |
| `free-tier` | **Deferred.** Would use server env `ANTHROPIC_API_KEY` and enforce `FREE_TIER_DAILY_CAP_CENTS` per user | Server env | Would require a persistent counter — not implemented yet |

`free-tier` is a named mode in code (`getLlmMode()` can return it) but it is never active in the v1 deployment. Turning it on later is a matter of adding a Supabase `usage_counters` table and an admission check in `api/explain-move.ts`. The feature flag path is in place; the implementation is not.

**BYOK data flow:**
1. User pastes key in `/settings` → stored in IndexedDB via `lib/byokStorage.ts`.
2. On every coach call, `withByokHeader(h)` adds `X-User-API-Key` to the outgoing fetch.
3. `api/_lib/anthropicClient.ts` reads the header, constructs a one-shot `new Anthropic({ apiKey: headerKey })`, uses it for the single call, and lets it go out of scope. Logs redact the header.
4. On 401/403 the server returns `{ error: 'invalid_key' }` and the frontend shows a banner in Settings prompting the user to re-enter their key.

**Security & legal checklist (Phase 11):**
- HTTPS enforced by Vercel; strict CSP in `vercel.json`.
- CORS locked to same-origin for all `/api/*`.
- BYOK key never logged, never persisted server-side, never round-tripped to any non-Anthropic destination.
- Supabase RLS policies reviewed before go-live.
- Privacy policy + terms of service pages live.
- Sentry DSN optional; off by default. When on, BYOK header and full prompts are scrubbed from breadcrumbs.

**Environment variables:**

| Variable | Where | Required? | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Server | No (only if `free-tier` enabled later) | Reserved for the deferred shared-quota mode |
| `FREE_TIER_DAILY_CAP_CENTS` | Server | No | Reserved; `0` means BYOK-only |
| `SUPABASE_URL` | Server | Yes | Admin client for migration function |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Admin client only; never exposed |
| `SENTRY_DSN` | Server | No | Error tracking |
| `VITE_SUPABASE_URL` | Client | Yes | Browser Supabase client |
| `VITE_SUPABASE_ANON_KEY` | Client | Yes | Browser Supabase client (RLS-guarded) |
| `VITE_SENTRY_DSN` | Client | No | Browser error tracking |

All `VITE_*` vars are baked into the static build. The server-only vars are injected at function runtime.

### 12b. Anonymous Timeline Limits

An **exploration branch** is defined as an `isExploration = true` subtree rooted at a child of a main-line node. Every call to `countExplorationBranches(tree)` walks the tree once and counts these roots; nested forks inside an existing branch do **not** increment the count (they are the same branch from the main game's perspective).

```ts
// src/lib/branchLimit.ts
export const MAX_ANON_BRANCHES = 3;

export function countExplorationBranches(tree: GameState): number {
  let count = 0;
  for (const id of walkMainline(tree)) {
    const node = tree.nodes.get(id)!;
    for (const childId of node.childrenIds) {
      const child = tree.nodes.get(childId)!;
      if (child.isExploration) count++;
    }
  }
  return count;
}
```

**Enforcement:** `gameStore.tryThisLine()` is the single chokepoint. If the user is anonymous (no Supabase session) **and** `countExplorationBranches(tree) >= MAX_ANON_BRANCHES`, the action is refused with a toast: *"You've used your 3 exploration branches. Log in to keep exploring this game."* Logged-in users have no cap.

**UX:** `MoveList.tsx` shows a small chip next to the game header reading `N/3 branches` for anonymous users. At `N = 3` the chip goes amber.

This is an abuse-surface limit, not a paywall — the rest of the app (playing, coaching, dashboards, drills) is unrestricted for anonymous users.

### 12c. Repository Flattening (Phase 1.5)

Phase 1 scaffolded the app as an npm workspace (`frontend/`) to leave room for a separate Express backend. The v4 architecture uses Vercel serverless functions instead of a separate backend service, so the `frontend/` wrapper is no longer earning its keep. Phase 1.5 flattens it:

- Move every file under `frontend/` up to the repo root.
- Delete the root `package.json` `workspaces` array and merge `frontend/package.json` into the root.
- Create `api/` at the root for serverless functions (empty stub files land in Phase 7).
- Create `vercel.json` with SPA rewrites and function runtime config.
- Verify `npm run dev`, `npx tsc --noEmit`, and `npm run build` still pass from the root.

No code changes, only file moves and `package.json` merging. This must complete before Phase 2 so Stockfish files land in the final `public/stockfish/` location.

---

## 13. Feature Parity Table

| Feature | LLM off / BYOK not set | LLM on (BYOK key set) |
|---|---|---|
| Play vs Stockfish | ✓ | ✓ |
| Quality badges per move | ✓ | ✓ |
| Best-move arrow | ✓ | ✓ |
| Coach explanation | Hand-authored template prose | Claude-generated, personalized to profile |
| Motif tags | Rule detectors | Rule detectors + LLM for fuzzy themes |
| Fork "try this line" | ✓ (anon capped at 3 branches/game) | ✓ (anon capped at 3 branches/game) |
| Weakness profile | ✓ (rule-tagged events) | ✓ (richer tags) |
| Adaptive prioritization | ✓ (template selection biased by profile) | ✓ (templates + prompt-level personalization) |
| Weakness dashboard | ✓ | ✓ |
| SRS practice drills | ✓ | ✓ |
| PGN export | ✓ | ✓ |
| Runs offline (local dev) | ✓ | ✗ (Claude API required) |
| Cross-device sync | ✓ when logged in (Supabase) | ✓ when logged in (Supabase) |

The only capability BYOK unlocks is **quality of coach prose**. Everything structural — gameplay, forking, weakness tracking, drills, dashboards, sync — is available to everyone.

---

## 14. Open Questions

- **Engine depth vs latency.** Do we want separate depths for the opponent's play and the analysis used for coaching?
- **Stockfish skill levels.** Map Stockfish's `Skill Level` 0–20 to named tiers ("Beginner / Club / Master")?
- **Streaming coaching.** Worth it for the first version, or defer?
- **Opening book depth.** How deep should the ECO book extend before we start coaching?
- **`free-tier` activation.** If we ever want to offer shared LLM, which is the smaller evil: a Supabase `usage_counters` table, or a Cloudflare Worker with a KV store in front of `/api/*`?

---

## 15. Build Phases — TODO Checklists

> **How to resume work:** find the first unchecked item in the first phase that isn't fully checked. Each phase is independently deployable.

### Phase 1 — Scaffolding & playable game ✓

- [x] Create `DESIGN.md`
- [x] Create `README.md`
- [x] Create root `package.json` (initially with `frontend/` workspace — flattened in Phase 1.5)
- [x] Create `.gitignore`
- [x] Scaffold `frontend/` (Vite React TS)
- [x] Add Tailwind CSS config
- [x] Install `chess.js`, `react-chessboard`, `zustand`, `uuid`
- [x] Implement `frontend/src/game/gameStore.ts` (flat move list, no tree yet)
- [x] Implement `frontend/src/components/Board.tsx`
- [x] Implement `frontend/src/components/MoveList.tsx`
- [x] Wire `App.tsx` with a two-pane layout
- [x] Verify: both sides playable manually in the browser (typecheck + build pass)
- [ ] Milestone commit

### Phase 1.5 — Repository flattening ✓

- [x] Move every file from `frontend/` up to the repo root
- [x] Merge `frontend/package.json` into the root `package.json`; remove the `workspaces` field
- [x] Update `vite.config.ts` (dropped the old Express proxy; dev/prod routing for `api/*` comes from Vercel, not Vite)
- [x] Create empty `api/` folder (stub files land in later phases)
- [x] Add `vercel.json` with SPA rewrites + `framework: vite`; pin Node 20 via `engines.node` in `package.json`
- [x] Verify: `npx tsc --noEmit` and `npm run build` both succeed from the root
- [ ] Milestone commit

### Phase 2 — Stockfish opponent

- [x] Vendor `stockfish.wasm` + loader into `public/stockfish/` (lite-single variant, 7MB, no COOP/COEP required)
- [x] Implement `src/engine/stockfishWorker.ts` (Web Worker bootstrap)
- [x] Implement `src/engine/analysis.ts` with `analyzePosition(fen, {depth})` and UCI parsing
- [x] Add request queue (promise-chain serialization — one search at a time, staleness via `analysisSeq`)
- [x] Hook Stockfish as the opponent (configurable skill level, side selection, undo/reset-aware)
- [x] Implement `src/components/EvalBar.tsx` (tanh squash curve, white-perspective, depth + thinking indicator)
- [x] Verify: `npx tsc -b` and `npm run build` both succeed from the root
- [ ] Milestone commit

### Phase 3 — Move classification & rule-based coaching

- [x] Implement `src/game/moveClassifier.ts` (thresholds from §5, mate-sentinel cpLoss, quality labels/colors)
- [x] Create `src/tagging/motifs.ts` with `MOTIF_VOCAB_VERSION = 1` and fixed vocabulary
- [x] Implement `src/tagging/phaseDetector.ts` (fullmove + material heuristic)
- [x] Implement `src/tagging/ruleDetectors.ts` — 5 initial motifs (missed_mate, missed_capture, hanging_piece, missed_fork, back_rank_weakness)
- [x] Implement `src/tagging/tagMove.ts` (rule-only path, async signature preserved for Phase 7 LLM merge)
- [x] Install `localforage`
- [x] Write `src/coach/templates.ts` with 22 hand-authored snippets keyed by `(quality, motif)` with phase-aware generics
- [x] Write `src/coach/motifPhrases.ts` short per-motif one-liners
- [x] Implement `src/coach/coachClient.ts` with **template path only** (LLM branch is Phase 7)
- [x] Implement `src/components/CoachPanel.tsx` (badge + motif chips + text + disabled "Try this line" placeholder)
- [x] Wire `gameStore` to call classifier → tagger → coach after every player move (engine moves bypass the pipeline, coach state cleared on reset/undo/jump)
- [x] Verify: `npx tsc -b` and `npm run build` both clean
- [ ] Milestone commit

### Phase 4 — Game tree & forking

- [x] Refactor `src/game/gameTree.ts` to the full tree model (§4.1)
- [x] Update `gameStore` to use the tree and track `mainGameHeadId` / `explorationRootId`
- [x] Implement `src/lib/branchLimit.ts` with `MAX_ANON_BRANCHES` and `countExplorationBranches`
- [x] Update `MoveList.tsx` to render mainline + indented variations with click-to-jump
- [x] Add branch-count chip for anonymous users
- [x] Implement `src/components/ForkBanner.tsx` with "Return to main game"
- [x] Wire the "Try this line" button in `CoachPanel` to create an exploration branch
- [x] Enforce anonymous cap in `gameStore.tryThisLine()` (and in `makeMove` when branching off a non-head mainline node)
- [x] Handle nested forks (sub-branches inside a branch extend the branch; only mainline-rooted branches count toward the anon cap)
- [x] Verify: `npx tsc -b` and `npm run build` both clean (85 modules, 311.75 kB / 95.64 kB gzipped)
- [ ] Milestone commit

### Phase 5 — Persistence & weakness profile

- [x] Implement `src/profile/types.ts` (§4.2)
- [x] Implement `src/profile/profileStore.ts` (Zustand + localforage, debounced save, `hydrate()` + `clearProfile()`)
- [x] Implement `src/profile/profileAggregates.ts` with exponential decay (`HALFLIFE_MS = 14d`, rolling K=50 phase window)
- [x] Implement `src/profile/weaknessSelector.ts` (`getTopWeaknesses`, `getRetiredWeaknesses`, `buildProfileSummary`)
- [x] Hook `gameStore` to append `WeaknessEvent`s on every inaccuracy/mistake/blunder (inside `kickAnalysis` coaching block; `incrementMoves` fires for every classified human move)
- [x] Update `src/coach/coachClient.ts` to bias template selection by top weaknesses (auto-injects `profileSummary`; `templates.ts` reorders motifs via `biasMotifsByProfile` + appends `reinforcementSuffix` when `decayedCount ≥ 3`)
- [x] Implement `src/components/WeaknessDashboard.tsx` + `DashboardPage.tsx` (CSS bar graphs + SVG sparkline; reusable as a right-rail widget later)
- [x] Implement `MistakesPage.tsx` (flat list with motif + phase filters, quality badge, best-move diff)
- [x] Persist games to localforage (save on game end / on mainline move) — `src/game/gameStorage.ts` + Map↔Array (de)serialization + per-game index; saves opportunistically after classification, after each engine move, and on `reset()`
- [x] Add router (`react-router-dom`) — `NavShell` + `routes.tsx` + `src/pages/{PlayPage,DashboardPage,MistakesPage}.tsx`; `main.tsx` now wraps `<App />` in `BrowserRouter` and kicks off `profileStore.hydrate()` before first render
- [ ] Verify: playing multiple games updates the dashboard and coaching prioritization
- [ ] Milestone commit

### Phase 6 — SRS practice

- [ ] Implement `src/srs/types.ts` and `src/srs/scheduler.ts` (SM-2)
- [ ] Implement `src/srs/practiceStore.ts` (localforage)
- [ ] Auto-convert new `WeaknessEvent`s into `PracticeCard`s
- [ ] Implement `src/components/PracticeDrawer.tsx` + `PracticePage.tsx`
- [ ] Add "Warm up with drills" prompt at session start
- [ ] Verify: drills pull from recent blunders and SM-2 scheduling works
- [ ] Milestone commit

### Phase 7 — BYOK LLM proxy (Vercel functions)

- [ ] Install `@anthropic-ai/sdk`, `lru-cache` at repo root
- [ ] Implement `src/lib/byokStorage.ts` (IndexedDB-backed key storage)
- [ ] Add BYOK key input to `SettingsPage.tsx` with validation and clear-key button
- [ ] Implement `api/_lib/anthropicClient.ts` (ephemeral client from header or env)
- [ ] Implement `api/_lib/cache.ts` (module-level lru-cache instance)
- [ ] Implement `api/_lib/prompts/explain.ts` and `api/_lib/prompts/tag.ts`
- [ ] Implement `api/health.ts` → `{ llmMode }`
- [ ] Implement `api/explain-move.ts` (BYOK-gated, cached, 300-token cap)
- [ ] Implement `api/tag-move.ts` (BYOK-gated, JSON schema enforcement)
- [ ] Implement `src/lib/featureFlags.ts` with `getLlmMode()` + `hasLLM()`
- [ ] Add LLM mode badge to `NavShell.tsx`
- [ ] Update `src/coach/coachClient.ts` to try LLM first, fall back on failure, attach `X-User-API-Key`
- [ ] Update `src/tagging/tagMove.ts` to augment rule tags with LLM tags when available
- [ ] Inject `profileSummary` into explain requests
- [ ] Verify: BYOK off → unchanged; setting a key → explanations upgrade live; 401 → banner in settings
- [ ] Milestone commit

### Phase 8 — Vercel deployment

- [ ] Create Vercel project pointed at the repo
- [ ] Configure env vars (leave `ANTHROPIC_API_KEY` unset — BYOK-only for v1)
- [ ] Verify SPA rewrites work for all routes in §3a
- [ ] Verify `api/*` functions deploy and respond
- [ ] Smoke-test the public URL end-to-end (anonymous play, fork, dashboard, BYOK)
- [ ] Milestone commit

### Phase 9 — Supabase auth & sync

- [ ] Create Supabase project; apply schema from §12a
- [ ] Write RLS policies for every user-scoped table
- [ ] Install `@supabase/supabase-js`
- [ ] Implement `src/sync/supabaseClient.ts` (browser anon client)
- [ ] Implement `LoginPage.tsx` (email magic link)
- [ ] Implement `src/lib/anonId.ts` (stable device UUID)
- [ ] Implement `src/sync/remoteGameStore.ts` and `remoteProfileStore.ts`
- [ ] Route `gameStore` / `profileStore` reads & writes through remote stores when logged in
- [ ] Implement `api/migrate-anonymous.ts` (service-role transaction)
- [ ] Implement `src/sync/migrateAnonymous.ts` (client orchestration)
- [ ] Implement `OnboardingPage.tsx` with migration prompt on first login
- [ ] Verify: sign up on device A, play a game, log in on device B, see the same game + profile
- [ ] Milestone commit

### Phase 10 — User-journey pages

- [ ] Install `react-router-dom`, `recharts`, `clsx`, `date-fns`
- [ ] Implement `src/routes.tsx` and `NavShell.tsx`
- [ ] Build `HomePage.tsx` (landing + CTA)
- [ ] Build `LibraryPage.tsx` and `GameReviewPage.tsx`
- [ ] Build `ProfilePage.tsx`
- [ ] Wire `SettingsPage.tsx` (engine depth, Stockfish skill, coaching verbosity, LLM override, data export, clear local data)
- [ ] Verify: all routes in §3a resolve and nav works logged-in and anonymous
- [ ] Milestone commit

### Phase 11 — Legal, privacy, hardening

- [ ] Write `PrivacyPage.tsx` (data we store, BYOK handling, deletion flow)
- [ ] Write `TermsPage.tsx`
- [ ] Add CSP + security headers to `vercel.json`
- [ ] Audit logs for BYOK redaction
- [ ] Add data-export and data-delete buttons in `SettingsPage.tsx` (local + Supabase)
- [ ] Review RLS policies
- [ ] Optional: wire up Sentry with header scrubbing
- [ ] Milestone commit

### Phase 12 — Polish

- [ ] Implement `src/game/pgn.ts` (PGN export with variations)
- [ ] Add best-move arrow overlay on the board
- [ ] Implement `src/tagging/ecoLookup.ts` and `book` classification for early moves
- [ ] Add additional motif detectors (pin, skewer, overloaded defender, king safety drop, trade-into-bad-endgame)
- [ ] Optional: streaming coach responses (LLM mode)
- [ ] Optional: promotion picker UI (currently auto-queens)
- [ ] Write `tests/` for moveClassifier, ruleDetectors, gameTree operations, SM-2, branchLimit
- [ ] Milestone commit

---

## 17. Player Journey & Progression

### 17.1 Overview & Auth Gate

The journey system provides a structured progression path that makes improvement visible and encourages consistent play. **It is exclusively available to authenticated users** (`status === 'authenticated'`). Anonymous and unconfigured users see no levels, no progress bars, no calibration UI — they get the generic HomePage hero and feature cards. This is a deliberate retention incentive: the journey is a reason to sign in.

**Reasoning:** Tying progression to auth serves two purposes. First, journey state must persist across devices, which requires a user identity. Second, it creates a natural upgrade path — anonymous users play freely, and when they sign in they unlock a structured learning experience built on top of the same games they've already played.

### 17.2 Calibration Phase

Before assigning a level, the system needs a baseline. New authenticated users play **2 calibration games**. During this phase:

- The Home page shows a journey pitch (the level ladder, what calibration is, a CTA to play).
- A CalibrationCard shows "Game N of 2 — calibrating your level..." on the Play and Home pages.
- No rating or level is displayed — reducing pressure on the first games.
- Stockfish skill starts at 10 (mid-range). After the first calibration game, auto-adjust by +3 or -3 based on whether the player's ACPL was below or above 50 (the ~1400 Elo midpoint). This ensures the second game is at a more appropriate challenge level.

After 2 games, the system computes a **weighted average ACPL** (game 1 weight 1.0, game 2 weight 1.5 — the more recent game matters slightly more), converts it to Elo via `acplToRating()`, and assigns the initial level.

A one-time **reveal card** appears showing the assigned level, its description, focus areas, and what the next level looks like.

**Why 2 games, not 5:** Two games is the minimum for a meaningful baseline while keeping the barrier to entry very low. A 5-game calibration means most casual users never finish it — they churn before seeing any progression UI. Two games can be completed in a single session (15-20 minutes), which means the user sees their level the same day they sign up. The weighting toward the second game compensates for first-game jitters.

### 17.3 Level Definitions

Six levels, each with an Elo anchor, suggested Stockfish skill range, and focus areas drawn from the existing motif vocabulary.

| Level | Elo Range | Stockfish Skill | Focus Motifs | Description |
|---|---|---|---|---|
| **Newcomer** | < 900 | 1-4 | `hangingPiece`, `undefendedPiece` | Learning the basics — avoid giving away pieces |
| **Learner** | 900 - 1199 | 5-8 | `missedFork`, `missedPin` | Building fundamentals — spot simple tactics |
| **Club Player** | 1200 - 1499 | 9-11 | `kingSafetyDrop`, `pawnStructure` | Solid and improving — develop strategic awareness |
| **Competitor** | 1500 - 1799 | 12-15 | `missedSkewer`, `overloadedDefender` | Strategically aware — deeper tactics and planning |
| **Advanced Thinker** | 1800 - 2199 | 16-18 | `badEndgameTrade`, `weakBackRank` | Deep understanding — precision and endgame mastery |
| **Expert** | 2200+ | 19-20 | All motifs | Elite precision — complex strategy and calculation |

**Why 6 levels instead of 11:** Fewer levels mean each promotion is a meaningful event. With 11 levels, mid-tier players can plateau for weeks between promotions, which kills motivation. Six levels keep the next milestone within reach — the widest Elo band is 400 points (Advanced Thinker), which a consistently improving player can traverse in 20-30 games.

**Why these Elo anchors:** They map directly to the existing `acplToRating()` conversion table. The boundaries (900, 1200, 1500, 1800, 2200) correspond to natural breakpoints in the ACPL→Elo curve where play quality shifts meaningfully.

### 17.4 Multi-Source Progress

Each level has a **progress bar** from 0% to 100%. Three activities contribute progress:

1. **Playing games** (+5-15% per game) — Based on how the game's ACPL compares to the current level's expected range. A game played above the player's level earns more. A game played well below earns less (but never zero — playing always counts).

2. **Reviewing mistakes** (+3-5% per review) — Triggered when a logged-in user opens a game from the Mistakes page (detected via the `?move=` query param). The act of revisiting a mistake and stepping through the position earns credit. Capped at 3 reviews per day to prevent grinding.

3. **Reducing weaknesses** (+10% bonus) — Awarded automatically when a motif's `decayedCount` drops below a threshold (i.e., the player stopped making that type of mistake recently). This hooks into the existing exponential decay system — no new tracking needed.

**Why multi-source:** Single-source progress (play games only) means the only way to engage is a 15-minute game. Multi-source progress lets users advance in 2-minute sessions (review a mistake, check their profile). This dramatically increases session frequency. Duolingo, chess.com, and every high-retention learning app uses this pattern.

**Why no puzzles/drills as a source:** The existing SRS practice system could be wired in later, but the three sources above work entirely with features that already exist in the codebase. No new UI screens needed for the MVP.

### 17.5 Promotion Criteria

To level up, a player must satisfy **both**:

1. **Progress bar at 100%** — earned through the three sources above.
2. **Rolling Elo ≥ next level's floor** — the weighted average of the last 10 games (or all games if fewer than 10) must meet the threshold. This prevents gaming the progress bar with volume alone.

Additionally: **minimum 5 games at current level** — prevents instant skip-through from lucky calibration.

On promotion:
- A `PromotionBanner` appears on the Home page showing the new level, what improved, and new focus areas.
- A suggestion to adjust Stockfish skill is shown (non-blocking).
- The promotion is recorded in `promotionHistory` for the profile timeline.

**Why a dual gate (progress + Elo):** Progress bar alone rewards quantity. Elo gate alone ignores effort. The combination means you must both put in the work (reviews, consistent play) AND demonstrate the skill. This makes promotions feel earned.

### 17.6 No Demotion

**Level titles never drop.** If performance declines, the progress bar drains toward 0%, but the player keeps their level. This is a deliberate design choice.

**Reasoning:** Demotion is the #1 reason users quit progression systems. A player who reaches Club Player and then has a bad week should not wake up to "You're a Learner again." The progress bar draining is sufficient negative feedback — it communicates "you need to play better to advance" without the psychological damage of losing a title. The player's high-water mark is always preserved.

If the rolling Elo drops significantly below the current level's floor, the progress bar sits at 0% and the journey card shows "Your recent games suggest you're playing below your level — keep practicing to get back on track." This is gentler than demotion and still communicates the situation honestly.

### 17.7 Home Page States (Authenticated Users)

The Home page renders three distinct views based on auth + journey state:

1. **Not logged in** — Generic hero ("Welcome to altmove"), feature pitch, "Play now" CTA, feature cards. No journey UI. This is the current behavior, unchanged.

2. **Logged in, not yet calibrated** — Journey pitch section:
   - Headline: "Your Chess Journey Starts Here"
   - Visual level ladder showing all 6 levels with brief descriptions
   - Explanation of calibration: "Play 2 games and we'll find your starting level"
   - Prominent CTA: "Play your first game"
   - If 1 of 2 calibration games is done: "1 more game to go — almost there"

3. **Logged in, calibrated** — Journey dashboard:
   - JourneyCard at top (level, rating, progress bar, next milestone, focus areas)
   - PromotionBanner if just promoted (dismissable)
   - Quick stats (games, moves, rating)
   - Feature cards

### 17.8 Profile Page Integration

- **Authenticated + calibrated:** JourneyCard rendered at the top of the profile, above the existing stats/trends.
- **Authenticated + not calibrated:** CalibrationCard shown instead ("Play N more games to unlock your level").
- **Not authenticated:** No journey UI — existing profile content only.

### 17.9 Data Model

Added to `PlayerProfile`:

```ts
interface JourneyState {
  calibrationGamesPlayed: number;    // 0, 1, or 2
  calibrated: boolean;               // true after 2 games
  currentLevel: string;              // level key (e.g. 'clubPlayer')
  levelProgress: number;             // 0-100
  rollingRating: number;             // weighted avg of last 10 games
  gamesAtCurrentLevel: number;       // resets on promotion
  reviewCreditsToday: number;        // caps at 3 per day
  reviewCreditDate: string;          // ISO date for daily reset
  promotionHistory: Array<{ level: string; timestamp: number }>;
  lastPromotionDismissed: boolean;   // user dismissed the banner
}
```

Journey state is recomputed from the existing `acplHistory` and `weaknessEvents` arrays whenever a game finishes or a mistake is reviewed. The append-only event log remains the source of truth; journey state is a derived projection.

### 17.10 Implementation Files

**New files:**
- `src/lib/journey.ts` — Pure functions: `computeRollingRating`, `assignInitialLevel`, `computeLevelProgress`, `checkPromotion`, `drainProgress`, `suggestedSkillRange`, `levelFocusAreas`, `levelMeta`, level constants
- `src/components/JourneyCard.tsx` — Progress card for Home/Profile
- `src/components/PromotionBanner.tsx` — Celebration banner
- `src/components/CalibrationCard.tsx` — "Calibrating..." indicator

**Modified files:**
- `src/profile/types.ts` — Add `JourneyState` to `PlayerProfile`
- `src/profile/profileAggregates.ts` — Call journey logic in `recordGameFinished()`
- `src/profile/profileStore.ts` — Expose journey state, add `dismissPromotion()` and `recordMistakeReview()` actions
- `src/lib/rating.ts` — Add `ALL_LEVELS`, `ratingForLevel()`, `nextLevel()`
- `src/pages/HomePage.tsx` — Three-state rendering based on auth + journey
- `src/pages/ProfilePage.tsx` — JourneyCard / CalibrationCard at top
- `src/pages/GameReviewPage.tsx` — Call `recordMistakeReview()` on load when `?move=` param is present

---

## 16. Setup

See `README.md` for run instructions. Short version:

- **Local dev, no LLM, no Supabase:** `npm install && npm run dev`. Works offline. Games + profile live in IndexedDB.
- **Local dev with Supabase:** set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`, then `npm run dev`.
- **Local dev end-to-end including `/api/*`:** `vercel dev`.
- **Production:** push to the Vercel-linked branch. Env vars configured in the Vercel dashboard per §12a.
- **BYOK:** users paste their `ANTHROPIC_API_KEY` in `/settings` after the app loads. Nothing to configure server-side.
