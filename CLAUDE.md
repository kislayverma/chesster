# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev              # Vite dev server on :5173 (frontend only, no serverless)
vercel dev               # Full stack: Vite + api/ serverless functions
npm run build            # tsc -b && vite build → dist/
npm run typecheck        # tsc -b --noEmit (type-check without emitting)
npm run vendor:stockfish # Vendor Stockfish WASM into public/stockfish/ (also runs on postinstall)
```

There are no tests or linter configured in this project.

## What This Is

Chesster (package name: altmove) is a browser-based chess learning app. Players play against Stockfish, receive real-time per-move coaching, and can fork into alternate lines to explore better moves before returning to the main game. Mistakes feed a persistent weakness profile that personalizes coaching and generates spaced-repetition drills.

LLM coaching is optional (BYOK-only). The app works fully offline with rule-based coaching and templates. Users who want Claude-generated prose paste their own Anthropic API key in Settings.

## Architecture

### Tech Stack

React 18 + TypeScript + Vite frontend. Zustand for state. Tailwind CSS for styling. Supabase for optional auth/sync. Vercel Edge Runtime for serverless API functions. chess.js for move validation. stockfish.wasm (lite-single) in a Web Worker for analysis. react-chessboard for the board UI.

### Key Directories

- `src/` - Frontend application
- `api/` - Vercel Edge Runtime serverless functions (health, explain-move, tag-move, migrate-anonymous, player-narrative, summarize-game)
- `api/_lib/prompts/` - LLM system and user prompt builders
- `public/stockfish/` - Vendored Stockfish WASM (generated at postinstall, gitignored)

### Core Source Layout (`src/`)

- `game/` - Game tree data structure (stack-of-frames model), game store, move classification, game storage
- `coach/` - Coaching pipeline: LLM-first with template fallback
- `tagging/` - 10 rule-based motif detectors + optional LLM augmentation
- `profile/` - Weakness tracking with exponential-decay aggregation, journey/progression state
- `srs/` - SM-2 spaced repetition scheduler and practice cards
- `engine/` - Stockfish Web Worker integration
- `auth/` - Supabase auth store (magic-link OTP)
- `sync/` - Sync orchestrator + remote stores for dual-write
- `lib/` - Utilities (feature flags, rating/Elo, journey levels, ECO openings)
- `pages/` - Page components
- `components/` - Reusable UI components

### Game Tree Model

The game tree uses a **stack-of-frames** (fork-and-return) architecture. Frame 0 is the permanent mainline. Exploration branches are pushed as new frames and popped destructively. Key types are `MoveNode`, `StackFrame`, and `GameTree` in `src/game/gameTree.ts`.

### Per-Move Pipeline

When a move is made: validate (chess.js) → update tree → branch check → Stockfish analysis → classify quality (cpLoss thresholds) → tag motifs (rule detectors + optional LLM) → record weakness → coach (LLM async + template fallback) → persist (IndexedDB + Supabase dual-write) → engine reply.

All LLM calls are non-blocking. The coach panel shows "thinking..." while the board continues.

### State Management Pattern

Three Zustand stores (game, profile, practice) follow the same pattern:
- `hydrate()` loads from IndexedDB on startup
- Every mutation does `set()` + debounced local save (500ms) + fire-and-forget remote write to Supabase
- Pages gate on `store.hydrated` before rendering
- Lazy imports (`await import(...)`) are used to break circular dependencies between stores and sync

### LLM Integration

Feature flags in `src/lib/featureFlags.ts` manage three modes: `off`, `byok-only`, `free-tier` (deferred). BYOK keys are stored in IndexedDB, sent as `X-User-API-Key` header to `/api/*` endpoints, used once, and discarded. Any LLM failure silently falls back to templates.

### Move Quality Thresholds

```
cpLoss ≤ 10 → best,  ≤ 25 → excellent,  ≤ 50 → good
≤ 100 → inaccuracy,  ≤ 200 → mistake,   > 200 → blunder
```

Losing a forced mate is always `blunder`. ECO book moves get `book` quality.

### Journey Progression

6 levels (Newcomer → Expert) with Elo ranges mapping to Stockfish skill levels. Promotion requires: progress >= 100%, rolling Elo >= next level's floor, and >= 5 games at current level. No demotion.

### Deployment

Single Vercel project. `dist/` served from edge, `api/*.ts` as Edge Runtime functions. `vercel.json` configures SPA rewrites, cache policies, and security headers. Supabase env vars are optional - without them, the app runs in local-only mode.

### Environment Variables

Client-side (`VITE_*`, baked at build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`.
Server-side: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DISABLE_LLM_PROXY`.

BYOK keys are never in env vars - they're entered by users in `/settings` and stored in IndexedDB.
