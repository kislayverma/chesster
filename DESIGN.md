# altmove — Design Document

> **Status:** All core phases complete. The app is a fully functional chess training platform with Stockfish opponent, AI coaching (BYOK Claude), game tree with branching explorations, weakness profiling, spaced-repetition practice, player journey/progression, Supabase auth + cross-device sync, and a game library with review. `tsc --noEmit` and `vite build` clean (174 modules).

---

## 1. Overview

altmove is a browser-based chess learning application. The player plays a full game against Stockfish, and after every move a coach explains how good or bad the move was and what the engine's preferred move would have been.

The two distinguishing features are:

1. **Inline fork-and-return.** At any point the player can accept the coach's suggestion and "try that line instead." The game forks into an alternate reality where the suggested move is played, the player continues playing from there, and when they are done exploring they return to the main game at the exact point they left off. Nothing is lost — every fork is stored in the game tree and is revisitable.

2. **Adaptive coaching across games.** Every mistake feeds a persistent player profile tagged by motif, phase, and opening. The coach uses this profile to prioritize what to teach, and the app builds a spaced-repetition deck of drills from the player's own blunders.

### LLM is optional — default is BYOK

altmove works fully offline with zero external dependencies. The default LLM mode is **`byok-only`**: coaching upgrades to Claude-generated prose only for users who paste their own `ANTHROPIC_API_KEY` in Settings. Anonymous and logged-in users without a key get deterministic rule-based detectors + hand-authored templates. **Every user-visible feature works in both modes.** LLM mode only upgrades *quality*, not *capability*.

### Public hosting

altmove is designed to be deployed as a single public web app. The whole thing — static frontend + serverless functions + auth + database — runs on **Vercel + Supabase**, with the frontend also runnable standalone for local development without any cloud dependency. Login is optional: anonymous users get a fully working local-only experience; logging in migrates their local data server-side and enables cross-device sync. Anonymous users are capped at **2 parallel exploration branches** per game.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Build / framework | Vite + React 18 + TypeScript | Fast dev loop; Vite output is static, perfect for Vercel's edge |
| Routing | `react-router-dom` v6 | Client-side routes for the multi-page app |
| Styling | Tailwind CSS | Low-ceremony styling |
| State | Zustand | Lightweight store, fits the tree-based game state |
| Local persistence | `localforage` (IndexedDB) | Anonymous-mode game store, practice deck, profile |
| Chess logic | `chess.js` | Move validation, FEN/PGN, legal moves |
| Board UI | `react-chessboard` | React-native API, drag/drop, arrows, highlights |
| Engine | `stockfish.wasm` in a Web Worker | World-class strength, runs entirely in the browser, UCI protocol |
| Server runtime | Vercel Serverless Functions (Node 20) | Single-deployment hosting; no separate backend box |
| Auth + DB | Supabase (Auth + Postgres + Row-Level Security) | Managed Postgres with built-in JWT auth and per-row access rules |
| LLM SDK | `@anthropic-ai/sdk` | Ephemeral client per request; key from BYOK header |
| Server cache | `lru-cache` (in-memory, per function instance) | Zero new infra; opportunistic |

---

## 3. Project Structure

```
altmove/
├── DESIGN.md
├── package.json
├── vercel.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
│
├── public/
│   └── stockfish/                  # stockfish.wasm + loader (vendored)
│
├── supabase/
│   ├── schema.sql                  # Full Supabase schema
│   └── migrations/
│       ├── 20260412_add_journey_state.sql
│       └── 20260414_add_byok_keys.sql
│
├── src/
│   ├── main.tsx                    # Entry point, auth init, feature flags
│   ├── App.tsx                     # <RouterProvider> root, hydration
│   ├── routes.tsx                  # Route table
│   ├── index.css                   # Tailwind imports
│   │
│   ├── pages/
│   │   ├── HomePage.tsx            # Auth-aware landing (journey ladder / hero)
│   │   ├── PlayPage.tsx            # Live game + coach + move list + stack
│   │   ├── LibraryPage.tsx         # Saved games list with filters
│   │   ├── GameReviewPage.tsx      # Read-only game replay with coach comments
│   │   ├── MistakesPage.tsx        # Flat list of WeaknessEvents with filters
│   │   ├── PracticePage.tsx        # SRS drills
│   │   ├── ProfilePage.tsx         # Stats, rating, weaknesses
│   │   ├── SettingsPage.tsx        # BYOK key, data controls
│   │   ├── LoginPage.tsx           # Email OTP auth
│   │   └── OnboardingPage.tsx      # New user setup + migration prompt
│   │
│   ├── components/
│   │   ├── Board.tsx               # react-chessboard wrapper + game-over modal
│   │   ├── MoveList.tsx            # Mainline + variation display
│   │   ├── CoachPanel.tsx          # Badge + motifs + explanation + "Try this move"
│   │   ├── StackPanel.tsx          # Exploration stack with mini-boards
│   │   ├── MiniBoard.tsx           # Small board preview with highlights
│   │   ├── NavShell.tsx            # Top nav + LLM badge
│   │   ├── JourneyCard.tsx         # Level progress + sparkline
│   │   ├── WeaknessDashboard.tsx   # Top motifs + phase breakdown
│   │   ├── PromotionBanner.tsx     # Level-up celebration
│   │   ├── PracticePrompt.tsx      # Post-game review CTA
│   │   └── boardAssets.tsx         # Chess piece SVGs
│   │
│   ├── engine/
│   │   ├── stockfishWorker.ts      # Web Worker bootstrap
│   │   └── analysis.ts             # analyzePosition(fen) API
│   │
│   ├── game/
│   │   ├── gameTree.ts             # MoveNode tree + stack-of-forks operations
│   │   ├── gameStore.ts            # Zustand store for active game
│   │   ├── gameStorage.ts          # IndexedDB persistence (save/load/list)
│   │   ├── moveClassifier.ts       # cpLoss → quality
│   │   └── pgn.ts                  # PGN export
│   │
│   ├── coach/
│   │   ├── coachClient.ts          # LLM-first with template fallback
│   │   ├── templates.ts            # Hand-authored fallback prose
│   │   ├── motifPhrases.ts         # Short per-motif snippets
│   │   └── types.ts                # CoachRequest / CoachResponse
│   │
│   ├── tagging/
│   │   ├── motifs.ts               # Fixed motif vocabulary
│   │   ├── ruleDetectors.ts        # hanging piece, fork, pin, etc.
│   │   ├── phaseDetector.ts        # opening/middle/endgame
│   │   ├── ecoLookup.ts            # FEN → opening code
│   │   └── tagMove.ts              # Orchestrator: rules + optional LLM
│   │
│   ├── profile/
│   │   ├── profileStore.ts         # Zustand + localforage persistence
│   │   ├── profileAggregates.ts    # Rollups with exponential recency decay
│   │   ├── weaknessSelector.ts     # Top-N weaknesses for prompt/selection
│   │   └── types.ts                # PlayerProfile, JourneyState, etc.
│   │
│   ├── srs/
│   │   ├── scheduler.ts            # SM-2 implementation
│   │   ├── practiceStore.ts        # Due cards, results, Zustand
│   │   └── types.ts                # PracticeCard
│   │
│   ├── auth/
│   │   └── authStore.ts            # Supabase session, OTP, sign-in/out
│   │
│   ├── sync/
│   │   ├── supabaseClient.ts       # Browser anon-key client
│   │   ├── syncOrchestrator.ts     # Central sign-in/out coordinator
│   │   ├── remoteProfileStore.ts   # Supabase CRUD for profiles + events
│   │   ├── remoteGameStore.ts      # Supabase CRUD for games
│   │   ├── remotePracticeStore.ts  # Supabase CRUD for SRS cards
│   │   ├── remoteByokStore.ts      # Supabase CRUD for BYOK keys
│   │   └── migrateAnonymous.ts     # One-shot local → server upload on login
│   │
│   └── lib/
│       ├── rating.ts               # ACPL → Elo conversion + level definitions
│       ├── journey.ts              # Progression logic: progress, promotion, rolling rating
│       ├── featureFlags.ts         # LLM mode detection + BYOK header injection
│       ├── byokStorage.ts          # Read/write BYOK key in IndexedDB
│       ├── branchLimit.ts          # Anonymous branch cap
│       ├── anonId.ts               # Stable UUID for anonymous device
│       └── moveSound.ts            # Move/capture audio
│
└── api/                            # Vercel serverless functions (Node 20)
    ├── health.ts                   # GET — returns { llmMode }
    ├── explain-move.ts             # POST — Claude coaching proxy
    ├── tag-move.ts                 # POST — Claude motif tagger
    ├── migrate-anonymous.ts        # POST — server-side migration transaction
    └── _lib/
        ├── anthropicClient.ts      # Builds ephemeral client from BYOK header
        ├── cache.ts                # Module-level lru-cache instance
        └── prompts/
            ├── explain.ts
            └── tag.ts
```

### 3a. Screens & Navigation

| Route | Page | Auth | Purpose |
|---|---|---|---|
| `/` | `HomePage` | optional | Landing: hero + feature cards (anon), greeting + journey ladder + progress (logged in) |
| `/play` | `PlayPage` | optional | Live game vs Stockfish + coach panel + explorations |
| `/library` | `LibraryPage` | optional | Saved games list with search, date, and result filters |
| `/library/:gameId` | `GameReviewPage` | optional | Read-only mainline replay with coach comments and mistakes |
| `/mistakes` | `MistakesPage` | optional | Flat list of WeaknessEvents with motif + phase filters |
| `/practice` | `PracticePage` | optional | SRS drill runner; cards sourced from the player's own mistakes |
| `/profile` | `ProfilePage` | optional | Stats, rating graph, weakness dashboard, motif breakdown |
| `/settings` | `SettingsPage` | optional | BYOK key input, display name, data management |
| `/login` | `LoginPage` | no | Email OTP via Supabase Auth |
| `/onboarding` | `OnboardingPage` | logged-in | Display name + local → server migration prompt |

`NavShell.tsx` wraps every page and renders: logo → Play / Library / Mistakes / Practice → LLM mode badge → account menu.

---

## 4. Core Data Model

### 4.1 Game tree (stack-of-forks)

The game tree uses a **stack-of-forks** model where explorations are frames pushed onto a stack. The mainline (frame 0) is permanent; exploration frames can be pushed and popped destructively.

```ts
interface MoveNode {
  id: string;
  parentId: string | null;
  move: string | null;           // SAN; null for root
  uci: string | null;            // UCI notation (e.g. "g1f3")
  fen: string;                   // position AFTER this move
  moverColor: 'w' | 'b';
  evalCp: number | null;         // centipawn eval (white perspective)
  mate: number | null;           // mate-in-N if applicable
  bestMoveBeforeUci: string | null;
  quality: MoveQuality | null;
  motifs: string[];
  coachText: string | null;
  coachSource: 'llm' | 'template' | null;
  cpLoss: number | null;
  childrenIds: string[];
}

interface StackFrame {
  id: string;
  index: number;                 // 0 = mainline
  parentFrameId: string | null;
  forkPointNodeId: string | null;
  nodeIds: string[];
  label: string;
}

interface GameTree {
  id: string;
  rootId: string;
  currentNodeId: string;
  mainGameHeadId: string;        // tip of frame 0 — the "real game"
  stackFrames: StackFrame[];
  currentFrameId: string;
  result: '1-0' | '0-1' | '1/2-1/2' | null;
  startedAt: number;
  nodes: Map<string, MoveNode>;
}
```

**Invariants:**
- The mainline is frame 0. `mainGameHeadId` is updated only when extending frame 0.
- Exploration frames are created by `pushFrame()` and removed by `popToFrameId()`.
- `currentNodeId` determines which position the board renders (can be on any frame).
- Game completion checks both the mainline head and the current node — a game-over on any branch finishes the entire game.
- `tree.result` is the authoritative game-level result. Once set, no moves are allowed on any frame.

### 4.2 Player profile

```ts
interface JourneyState {
  displayName?: string;
  calibrationGamesPlayed: number;
  calibrated: boolean;
  currentLevel: string;
  levelProgress: number;           // 0-100 (capped at 99 if promotion blocked)
  rollingRating: number;
  gamesAtCurrentLevel: number;
  reviewCreditsToday: number;
  reviewCreditDate: string;
  promotionHistory: Array<{ level: string; timestamp: number }>;
  lastPromotionDismissed: boolean;
}

interface PlayerProfile {
  totalGames: number;
  totalMoves: number;
  weaknessEvents: WeaknessEvent[];
  motifCounts: Record<string, MotifCounter>;
  phaseCpLoss: { opening: number; middlegame: number; endgame: number };
  openingWeaknesses: Record<string, OpeningStat>;
  acplHistory: AcplHistoryEntry[];
  journeyState: JourneyState;
  createdAt: number;
  updatedAt: number;
}
```

Aggregates use **exponential recency decay** (`HALFLIFE_MS = 14 days`) so old events fade and the weakness profile reflects *current* weaknesses.

### 4.3 SRS practice

```ts
interface PracticeCard {
  id: string;
  eventId: string;
  gameId: string;
  fen: string;
  bestMove: string;              // SAN — the answer
  playerMove: string;
  motifs: string[];
  quality: string;
  moveNumber: number;
  easeFactor: number;            // SM-2
  intervalDays: number;
  repetitions: number;
  dueAt: number;
  lastReview: number;
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

Where `cpLoss = evalBefore − evalAfter`, normalized to the moving side's perspective.

Special cases:
- A move that loses a forced mate is always `blunder`.
- Moves matched against an ECO opening book are labeled `book`.
- Brilliant and great classifications exist for moves that find the only good move in complex positions.

---

## 6. LLM-Optional Contract

The coach pipeline is designed so the LLM is never in the critical path:

1. `featureFlags.ts` probes `GET /api/health` on startup (800ms timeout). Also reads the BYOK key from IndexedDB.
2. `coachClient.ts` attempts Claude via `POST /api/explain-move` with `X-User-API-Key` header.
3. On any failure (timeout, 401, network error), silently falls back to `templates.ts` hand-authored prose.
4. `tagMove.ts` runs rule detectors always; augments with LLM tags when available.

**Key properties:**
- LLM calls are concurrent with engine analysis and never block move playback.
- A header badge in `NavShell` displays the current mode (`LLM: off` / `LLM: byok`).
- In BYOK mode the key is stored in IndexedDB locally and in Supabase's `byok_keys` table for cross-device persistence. It is sent as `X-User-API-Key` on each LLM call and never logged or persisted by the server.

---

## 7. Rule-Based Motif Detectors

Implemented in `src/tagging/ruleDetectors.ts`. Each is a pure function over `(fenBefore, playerMove, bestMove, pv, chessInstance)`.

| Motif | Detection |
|---|---|
| `hanging_piece` | Opponent's best reply after the player's move captures an undefended piece |
| `missed_capture` | A free piece existed before the move and wasn't taken |
| `missed_fork` | `bestMove` attacks 2+ valuable targets; `playerMove` doesn't |
| `missed_pin` | Engine's best move exploits or creates a pin the player missed |
| `missed_skewer` | Engine's best move exploits a skewer opportunity |
| `missed_mate` | `bestMove` has `mate > 0`; `playerMove` doesn't |
| `back_rank_weakness` | King on back rank with no luft; `bestMove` exploits/defends |
| `king_safety_drop` | Move weakens king safety significantly |
| `overloaded_defender` | A piece defending multiple targets can't handle them all |
| `trade_into_bad_endgame` | Exchange leads to a losing endgame structure |

Vocabulary is versioned via `MOTIF_VOCAB_VERSION` in `src/tagging/motifs.ts`.

---

## 8. Per-Move Flow

1. User drops a piece → `chess.js` validates.
2. New `MoveNode` inserted into the tree; `currentNodeId` updated; board re-renders immediately.
3. If the move is at a non-tip position, a new exploration frame is pushed (subject to branch cap for anonymous users).
4. Stockfish analyzes the new position → `{ evalAfter, bestMove, pv, mate }`.
5. `moveClassifier` computes `cpLoss` and assigns `quality`.
6. `tagMove(ctx)` runs → motifs attached to the node.
7. If `quality ∈ {inaccuracy, mistake, blunder}`:
   - A `WeaknessEvent` is appended to `profileStore`.
   - A `PracticeCard` is created in `practiceStore`.
   - Aggregates are recomputed (debounced).
8. `getCoachExplanation(req)` — returns LLM prose or a template; stored on the node and rendered in `CoachPanel`.
9. Game completion check: if the mainline head or current node is game-over, the game is marked finished — `tree.result` is set, ACPL is recorded, journey state is updated, game is persisted with `finishedAt`.
10. Engine plays its reply at the configured skill level. Loop.

---

## 9. Exploration Flow — "Try This Move"

1. User clicks **"Try this move"** in `CoachPanel` (only shown for inaccuracy/mistake/blunder, hidden when game is finished).
2. `gameStore.tryThisLine()` checks the branch cap. If anonymous and at the limit (2 branches), `branchCapReached` flag is set and an amber banner appears on the play page.
3. Otherwise, the store finds the **parent** of the current node (position before the mistake).
4. A new `MoveNode` is inserted as a child of that parent with the engine's best move.
5. A new `StackFrame` is pushed onto the stack.
6. `currentNodeId` and `currentFrameId` point to the new frame.
7. Player continues playing in the branch. Full coaching runs in the fork.
8. **StackPanel** shows all frames with mini-board previews. Branch frames show the fork position with red highlights (wrong move) and green highlights (alternate move).
9. Clicking any frame in the StackPanel pops back to it. "Back to your game" returns to the mainline.
10. Nested exploration is allowed — each push adds a frame to the stack.

### Branch limits

Anonymous users are capped at 2 exploration frames above the mainline (`MAX_ANON_BRANCHES = 2`). When the cap is reached, an amber banner appears with a link to sign in. Authenticated users have unlimited branches. The cap is enforced in three places: `makeMove` (when branching off a non-tip position), `tryThisLine`, and engine auto-play.

---

## 10. Weakness Profile & Adaptive Coaching

**Tagging** (§7) turns every mistake/blunder into a `WeaknessEvent`.

**Aggregation** runs on a debounce:
- `motifCounts[m].decayedCount = Σ exp(-(now - e.timestamp) / HALFLIFE)` for events tagged with motif `m`.
- `phaseCpLoss[phase]` = rolling average over last K events.
- `openingWeaknesses[eco]` = games + avg cpLoss per opening.
- `acplHistory` appended once per finished game.

**`getTopWeaknesses(profile, n)`** → top `n` motifs by `decayedCount`.

**Adaptive coaching:**
- **LLM mode:** `profileSummary` is injected into the explain prompt. The LLM connects feedback to recurring patterns.
- **Template mode:** `renderTemplate` prefers templates whose motifs match top weaknesses. A `reinforcementSuffix` is appended when `decayedCount ≥ 3`.

---

## 11. Spaced-Repetition Practice

`src/srs/scheduler.ts` implements SM-2. Every `WeaknessEvent` spawns a `PracticeCard`.

**Flow:**
- `PracticePage` presents due cards one at a time: the board renders `card.fen`, the player drags their answer.
- Correct → SM-2 bumps `intervalDays` and `easeFactor`.
- Incorrect → `intervalDays` resets, `easeFactor` reduced.
- Reviewing a mistake from the Mistakes page credits journey progress (max 3/day).

---

## 12. Player Journey & Progression

### 12.1 Overview

The journey system provides structured progression through six levels. **Exclusively available to authenticated users.** Anonymous users see the generic homepage; logging in unlocks the full journey experience. Everyone starts at Newcomer.

### 12.2 Level Definitions

| Level | Elo Range | Stockfish Skill | Auto Skill | Focus Motifs |
|---|---|---|---|---|
| **Newcomer** | < 900 | 1-4 | 3 | `hanging_piece`, `missed_capture` |
| **Learner** | 900 - 1199 | 5-8 | 7 | `missed_fork`, `missed_pin` |
| **Club Player** | 1200 - 1499 | 9-11 | 10 | `king_safety_drop`, `back_rank_weakness` |
| **Competitor** | 1500 - 1799 | 12-15 | 14 | `missed_skewer`, `overloaded_defender` |
| **Advanced Thinker** | 1800 - 2199 | 16-18 | 17 | `trade_into_bad_endgame`, `missed_mate` |
| **Expert** | 2200+ | 19-20 | 20 | All motifs |

**Auto Skill** = Stockfish automatically adjusts to the midpoint of the level's skill range on sign-in hydration and on promotion. The player can still manually override in game settings.

### 12.3 Rolling Rating

Weighted average of the last 10 games' ACPL→Elo values. More recent games are weighted higher (linearly increasing weights: game 1 = weight 1, game 10 = weight 10). Computed by `computeRollingRating()` in `journey.ts`.

### 12.4 Progress & Promotion

Each level has a progress bar from 0% to 100%. Three sources:

1. **Playing games** (+5-15%) — based on how the game's ACPL compares to the level's expected range.
2. **Reviewing mistakes** (+3-5%) — capped at 3 reviews per day.
3. **Reducing weaknesses** (+10% bonus) — when a motif's decayed count drops below threshold.

**Promotion requires ALL THREE:**
1. Progress bar at 100%
2. Rolling Elo ≥ next level's floor
3. Minimum 5 games at current level

**99% cap:** When progress reaches 100% but promotion is blocked (not enough games or rating too low), progress is capped at 99% and the UI shows "play N more games to promote" or similar guidance.

**No demotion.** Level titles never drop. If performance declines, the progress bar drains toward 0%, but the player keeps their level.

### 12.5 Game Completion on Branches

When a game reaches checkmate/stalemate/draw on **any** board (mainline or branch), the entire game tree is marked as completed:
- `tree.result` is set based on the ending position.
- All boards become read-only (moves blocked everywhere).
- The game-over modal shows on every board, not just the one where the game ended.
- ACPL is computed from the mainline for rating/journey updates.
- Game settings panel hides, "Try this move" hides, resign button hides.

### 12.6 Home Page States

1. **Not logged in** — Generic hero, feature cards, "Play now" CTA. Quick stats shown if games exist locally.
2. **Logged in** — Personalized greeting with time-of-day, full journey ladder (6 levels with chess piece icons, current level highlighted), progress bar to next level, play CTA.

---

## 13. Auth & Sync

### 13.1 Authentication

Email OTP via Supabase Auth. Flow:
1. User enters email on `/login`.
2. `signInWithEmail` sends a magic code.
3. User enters the 6-digit code.
4. `verifyOtp` completes authentication.
5. `onSignIn` callback triggers `hydrateFromRemote` — pulls profile, games, cards, and BYOK key from Supabase.

### 13.2 Onboarding

After first login, users land on `/onboarding`:
- Asked "What should we call you?" (stored as `journeyState.displayName`).
- If local anonymous data exists, offered a choice: merge it into their account or start fresh.
- Migration tracks decisions via IndexedDB claim to prevent re-prompting.

### 13.3 Sign Out

Clears all local state:
- IndexedDB (profile, games, practice cards via `localforage.clear()`)
- Zustand stores (profile, game, practice, auth)
- Local BYOK key cache
- Anonymous device ID

**Backend data is preserved** — the BYOK key, profile, games, and cards remain in Supabase and are restored on next sign-in.

### 13.4 Sync Architecture

**Local-first with optimistic updates:**
- All writes go to IndexedDB first, then fire-and-forget push to Supabase.
- Profile saves are debounced (500ms). Game saves happen after every classified move.
- On sign-in, full hydration from Supabase overwrites local state.
- `pushProfileRemote`, `pushGameRemote`, `pushByokKeyRemote` are fire-and-forget exports from `syncOrchestrator.ts`.

### 13.5 BYOK Key Persistence

BYOK API keys have dual storage:
- **Local:** IndexedDB via `byokStorage.ts` (for immediate use).
- **Remote:** Supabase `byok_keys` table (for cross-device persistence).
- On sign-in, the remote key is fetched and written to local cache.
- On sign-out, only the local copy is cleared; the backend key is preserved.
- The key is only deleted from the backend when the user explicitly clicks "Remove key" in Settings.

### 13.6 Supabase Schema

```
users                 (managed by Supabase Auth)
profiles              (user_id PK, total_games, total_moves, motif_counts jsonb,
                       phase_cp_loss jsonb, opening_weaknesses jsonb,
                       acpl_history jsonb, journey_state jsonb, ...)
weakness_events       (id PK, user_id, game_id, fen, player_move, best_move,
                       cp_loss, quality, phase, motifs text[], eco, color, ts)
games                 (id PK, user_id, started_at, updated_at, finished_at,
                       result, mainline_plies, human_color, engine_enabled, tree jsonb)
practice_cards        (id PK, user_id, event_id, game_id, fen, best_move,
                       player_move, motifs, quality, ease_factor, interval_days,
                       repetitions, due_at, last_review)
byok_keys             (user_id PK, api_key, created_at, updated_at)
```

Every table with `user_id` has RLS policies: `user_id = auth.uid()`.

---

## 14. Game Library

### Storage

Games are persisted to IndexedDB via `gameStorage.ts`:
- **Index key:** `chesster:games:index` → lightweight array of `PersistedGameIndexEntry`.
- **Game key:** `chesster:game:<id>` → full `PersistedGame` with serialized tree.
- The tree's `nodes` Map is flattened to an array for serialization and rehydrated on load.

### Library Page

- Lists all saved games sorted by `updatedAt`.
- Shows result, move count, color, date.
- In-progress games have a "Resume" button; finished games link to `/library/:gameId`.
- Search, date range, and result filters.
- Delete individual games.

### Game Review Page

- Loads a single game by ID and deserializes the tree.
- Walks the **mainline only** (`walkMainline(tree)`) — branches are not shown.
- Read-only board with forward/back/start/end navigation and keyboard shortcuts.
- Displays per-move coach comments and quality badges.
- Shows game metadata (date, result, color, opponent).
- Mistakes panel with links to specific positions.

### "Review game" from Game-Over Modal

When a game ends, the game-over modal offers "Review game" which navigates to `/library/:gameId` — the same read-only review experience as clicking a game from the library.

---

## 15. Server Surface

### Always-mounted
- `GET /api/health` → `{ llmMode: 'off' | 'byok-only' | 'free-tier' }`

### BYOK-gated
- `POST /api/explain-move` — validates `X-User-API-Key`, calls Claude, returns `{ explanation }`. Cached per `sha256(fen + move + profileHash)`.
- `POST /api/tag-move` — same pattern, returns motif tags. Cached per `sha256(fen + move)`.

### Auth/sync
- `POST /api/migrate-anonymous` — service-role Supabase call that migrates anonymous data to authenticated user.

### Environment Variables

| Variable | Where | Required? | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | Server | Yes | Admin client for migration |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Admin client only |
| `VITE_SUPABASE_URL` | Client | Yes | Browser Supabase client |
| `VITE_SUPABASE_ANON_KEY` | Client | Yes | Browser Supabase client (RLS-guarded) |

---

## 16. Key Constants

| Constant | Value | Location |
|---|---|---|
| `MAX_ANON_BRANCHES` | 2 | `lib/branchLimit.ts` |
| `MIN_GAMES_FOR_PROMOTION` | 5 | `lib/journey.ts` |
| `MAX_REVIEW_CREDITS_PER_DAY` | 3 | `lib/journey.ts` |
| `ROLLING_WINDOW` | 10 games | `lib/journey.ts` |
| `HALFLIFE_MS` | 14 days | `profile/profileAggregates.ts` |
| `SAVE_DEBOUNCE_MS` | 500ms | `profile/profileStore.ts` |
| Default search depth | 14 plies | `engine/analysis.ts` |
| Health probe timeout | 800ms | `lib/featureFlags.ts` |
| LLM call timeout | 15s | `coach/coachClient.ts` |

---

## 17. Feature Parity Table

| Feature | LLM off / BYOK not set | LLM on (BYOK key set) |
|---|---|---|
| Play vs Stockfish | yes | yes |
| Quality badges per move | yes | yes |
| Best-move arrow | yes | yes |
| Coach explanation | Hand-authored template prose | Claude-generated, personalized to profile |
| Motif tags | Rule detectors | Rule detectors + LLM for fuzzy themes |
| Fork "try this line" | yes (anon capped at 2) | yes (anon capped at 2) |
| Weakness profile | yes (rule-tagged events) | yes (richer tags) |
| Weakness dashboard | yes | yes |
| SRS practice drills | yes | yes |
| Game library + review | yes | yes |
| Player journey | yes (logged-in only) | yes (logged-in only) |
| Cross-device sync | yes (logged-in) | yes (logged-in) |
| Runs offline | yes | no (Claude API required) |

---

## 18. Setup

- **Local dev, no LLM, no Supabase:** `npm install && npm run dev`. Works offline.
- **Local dev with Supabase:** set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
- **BYOK:** users paste their `ANTHROPIC_API_KEY` in `/settings`.
- **Production:** push to Vercel-linked branch. Env vars in Vercel dashboard.
