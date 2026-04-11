# Chesster — Design Document

## 1. Overview

Chesster is a browser-based chess learning application. The player plays a full game against a Stockfish opponent, and after every move a coach (an LLM) explains in natural language how good or bad the move was and what the engine's preferred move would have been.

The distinguishing feature is **inline exploration**: at any point the player can accept the coach's suggestion and "try that line instead." The game forks into an alternate reality where the suggested move is played, and the player continues playing from there against the engine — still receiving coaching. When they are done exploring, they return to the main game at the exact point they left off. Nothing is lost; the fork remains in the game tree and is re-visitable.

The goal is to collapse the gap between "playing a game" and "studying a game" into a single continuous loop.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Build / framework | Vite + React + TypeScript | Fast dev loop, mature ecosystem |
| Styling | Tailwind CSS | Low-ceremony styling for an internal tool |
| State | Zustand | Lightweight store, fits the tree-based game state well |
| Chess logic | `chess.js` | De facto standard for move validation, FEN/PGN, legal moves |
| Board UI | `react-chessboard` | React-native API, drag/drop, arrows, highlights out of the box |
| Engine | `stockfish.wasm` in a Web Worker | World-class strength, runs entirely in the browser, UCI protocol |
| Coach LLM | Claude API via Express backend proxy | Keeps API key server-side; allows caching and rate limiting |

---

## 3. Project Structure

```
chesster/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Board.tsx              # react-chessboard wrapper
│   │   │   ├── MoveList.tsx           # Move history with quality badges and variation tree
│   │   │   ├── CoachPanel.tsx         # LLM feedback + "Try this line" button
│   │   │   ├── EvalBar.tsx            # Visual Stockfish evaluation
│   │   │   └── ForkBanner.tsx         # "You're in exploration mode — Return to main game"
│   │   ├── engine/
│   │   │   ├── stockfishWorker.ts     # Web worker wrapper around stockfish.wasm
│   │   │   └── analysis.ts            # analyzePosition(fen) → { evalCp, mate, bestMove, pv }
│   │   ├── game/
│   │   │   ├── gameTree.ts            # Tree data structure for variations
│   │   │   ├── moveClassifier.ts      # Centipawn loss → Best/Good/Mistake/Blunder
│   │   │   └── gameStore.ts           # Zustand store (current node, fork state)
│   │   ├── coach/
│   │   │   └── coachClient.ts         # Calls backend /api/explain-move
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   │   └── stockfish/                 # stockfish.wasm + loader
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── server.ts                  # Express app
│   │   ├── routes/explain.ts          # POST /api/explain-move
│   │   └── anthropic.ts               # Claude SDK client
│   ├── .env.example                   # ANTHROPIC_API_KEY=
│   └── package.json
├── DESIGN.md
├── README.md
└── .gitignore
```

---

## 4. Core Data Model — Game Tree

The game is modeled as a tree, not a list. This is what makes forking cheap and non-destructive.

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
  coachComment?: string;         // LLM explanation
  childrenIds: string[];         // first child = mainline continuation; others = variations
  isExploration: boolean;        // true if this node lives inside a "try this line" branch
}

interface GameState {
  nodes: Map<string, MoveNode>;
  rootId: string;
  currentNodeId: string;           // where the board is currently rendered
  mainGameHeadId: string;          // tip of the real game (what "Return" restores)
  explorationRootId: string | null; // set while in a fork, null otherwise
}
```

### Invariants

- **The main game is a single path** through the tree: root → ... → `mainGameHeadId`. Along this path every node has `isExploration = false`.
- **Exploration branches** are subtrees rooted at a sibling of a main-game node, with every node inside marked `isExploration = true`.
- **`currentNodeId` is the only source of truth for the board.** The board always renders `nodes.get(currentNodeId).fen`.
- **Nothing is ever deleted.** Variations accumulate in the tree and are browsable from the move list.

---

## 5. Move Classification

After each move, we compute **centipawn loss** (`cpLoss`) from the player's perspective:

```
cpLoss = evalBeforeMove - evalAfterMove
```

(Both evaluations are normalized to the moving side's perspective before subtracting.)

Thresholds:

| cpLoss | Quality |
|---|---|
| 0 – 10 | `best` |
| 11 – 25 | `excellent` |
| 26 – 50 | `good` |
| 51 – 100 | `inaccuracy` |
| 101 – 200 | `mistake` |
| 200+ | `blunder` |

Notes:
- Forced moves (only one legal move) skip classification.
- Opening-book moves are labeled `book` (Phase 5).
- For positions evaluated as mate, any deviation that loses the mate is always a `blunder`.

---

## 6. Per-Move Flow

1. Player drags a piece on `Board.tsx`.
2. `chess.js` validates the move. Illegal → drag snaps back.
3. `evalBefore` is already known (cached from the previous engine analysis on the current position).
4. The move is applied; a new `MoveNode` is inserted as a child of the current node and becomes the new `currentNodeId`.
5. The Stockfish worker analyzes the new FEN → returns `{ evalAfter, bestMove, pv, mate }`.
6. `moveClassifier` computes `cpLoss` and assigns `quality` to the new node.
7. `coachClient` POSTs `{ fenBefore, playerMove, bestMove, pv, quality, cpLoss }` to `/api/explain-move`.
8. The backend returns a 2–3 sentence explanation, which is stored on the node and shown in `CoachPanel`.
9. `CoachPanel` shows: quality badge + explanation + **"Try `bestMove` instead"** button (only if the move was not already best).
10. Stockfish picks its reply at the configured skill level. Loop repeats.

Steps 5 and 7 run concurrently: the engine analysis and the coaching request do not block each other.

---

## 7. Fork Flow — "Try This Line"

### Entering a fork

1. User clicks **"Try `bestMove` instead"** in the `CoachPanel`.
2. `gameStore` looks up the **parent** of the just-played move (the position before the player's mistake).
3. A new `MoveNode` is created as a *second* child of that parent, with the engine's best move, and `isExploration = true`.
4. `currentNodeId` is set to that new node.
5. `explorationRootId` is set to that new node.
6. A yellow `ForkBanner` appears at the top of the board: *"Exploration mode — Return to main game"*.

### Inside a fork

- The player continues playing normally. Every move made in the fork inherits `isExploration = true`.
- Coaching runs exactly the same as in the main game.
- Nested forks are allowed — each is just another branch in the tree.

### Returning

- Clicking **Return to main game** sets `currentNodeId = mainGameHeadId` and clears `explorationRootId`.
- The fork subtree remains in the tree and is visitable from the `MoveList`.

### Why this works

Because the main game is identified by a stable pointer (`mainGameHeadId`) and not by "most recent move," the player can dive in and out of any number of forks without losing their place. The tree accumulates a complete study artifact — a single PGN with variations — over the course of the session.

---

## 8. Stockfish Worker Contract

A single Stockfish worker instance is created at app startup. All analysis requests go through a simple queue.

```ts
// engine/analysis.ts

interface AnalysisResult {
  evalCp: number;         // from white's perspective; +100 = white up a pawn
  mate: number | null;    // e.g. 3 = mate in 3 for white, -2 = mate in 2 for black
  bestMove: string;       // UCI, e.g. "e2e4"
  pv: string[];           // principal variation in UCI
  depth: number;
}

function analyzePosition(
  fen: string,
  opts?: { depth?: number; movetime?: number }
): Promise<AnalysisResult>;
```

Internals:
- Wraps `stockfish.wasm` in a `Worker`.
- Uses UCI commands: `uci`, `isready`, `position fen ...`, `go depth N`, `stop`.
- Parses `info depth X score cp Y` and `bestmove ...` lines.
- Sends `stop` before starting a new analysis if one is in progress.
- Default depth: 15. Configurable in settings.

---

## 9. Backend Coaching Endpoint

### Why a backend

The Claude API key must never live in the browser. A tiny Express server exists solely to hold the key and proxy coaching requests.

### Endpoint

```
POST /api/explain-move
```

Request:
```json
{
  "fenBefore": "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "playerMove": "Nf3",
  "bestMove": "Nf3",
  "pv": ["Nf3", "Nc6", "Bb5"],
  "quality": "best",
  "cpLoss": 0
}
```

Response:
```json
{ "explanation": "Developing the knight toward the center..." }
```

### Prompt template

> You are a chess coach speaking to an intermediate student. The player is in this position (FEN: `<fenBefore>`). They played `<playerMove>`, which is classified as `<quality>` (centipawn loss: `<cpLoss>`). The engine's preferred move was `<bestMove>`, with the line `<pv>`. In 2–3 sentences, explain what is good or bad about the player's move and why the engine's choice is better. Avoid jargon where possible.

### Caching and rate limiting

- **LRU cache** keyed by `sha256(fenBefore + playerMove)` — identical (position, move) pairs hit the cache.
- **Rate limit** per IP (e.g. 60 requests/minute) via `express-rate-limit`.
- **Streaming** is not used in Phase 3; can be added in Phase 5 for a nicer UX.

---

## 10. Build Phases

### Phase 1 — Playable game (no engine)
- Scaffold `frontend/` with Vite + React + TS + Tailwind.
- Add `chess.js` and `react-chessboard`.
- Implement `Board.tsx`, `MoveList.tsx` with a flat move list and a very simple `gameStore` (no tree yet).
- You can play both sides manually.

### Phase 2 — Stockfish opponent
- Vendor `stockfish.wasm` into `frontend/public/stockfish/`.
- Build `stockfishWorker.ts` and `analyzePosition()`.
- Hook Stockfish as the opponent with a configurable skill level.
- Add `EvalBar.tsx` for a live visual evaluation.

### Phase 3 — Coaching
- Implement `moveClassifier.ts`.
- Scaffold `backend/` with Express + Anthropic SDK + rate limiting.
- Add `POST /api/explain-move` with the prompt template and LRU cache.
- Wire `CoachPanel.tsx` to display quality badge + Claude explanation after every player move.

### Phase 4 — Game tree + forking
- Refactor `gameStore` to the tree model described in §4.
- Update `MoveList.tsx` to show mainline + indented variations.
- Add the **"Try this line"** button to `CoachPanel`.
- Add `ForkBanner.tsx` with the **Return to main game** action.

### Phase 5 — Polish
- PGN export with variations.
- Persist sessions to `localStorage`.
- Settings panel: engine depth, Stockfish skill level, coaching verbosity.
- Best-move arrow overlay on the board.
- Optional: streaming coach responses, opening book detection.

---

## 11. Open Questions

- **Engine depth vs. latency.** Depth 15 on `stockfish.wasm` is fast but not always sharp. We may want the player-facing engine at one depth and the analysis/coaching engine at a deeper one.
- **Stockfish skill levels.** Stockfish has a `Skill Level` UCI option (0–20). How many levels should we expose, and should they map to named tiers ("Beginner / Club / Master")?
- **Persistence.** Phase 5 plans `localStorage`. Do we eventually want accounts + a database to share or resume games across devices?
- **Streaming coaching.** Worth the extra complexity for the first version, or defer?
- **Opening book.** Should early-game moves bypass coaching and simply be labeled `book` from an ECO database?

