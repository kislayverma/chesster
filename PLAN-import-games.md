# Plan: Chess.com & Lichess Game Import

## Design Decisions

- **API calls** go through a server-side Vercel Edge proxy (`api/import-games.ts`)
- **Analysis** is on-demand — games import unanalyzed, user clicks "Analyze" on individual games
- **Profile impact** — imported games are tracked separately and do **not** affect weakness profile, journey, or SRS drills

---

## Step 1: Data Model Extensions

**`src/game/gameTree.ts`** — Add source metadata types:
```typescript
type GameSource = 'live' | 'chesscom' | 'lichess' | 'pgn_upload';

interface ImportMetadata {
  source: GameSource;
  externalId?: string;
  whitePlayer?: string;
  blackPlayer?: string;
  whiteElo?: number;
  blackElo?: number;
  timeControl?: string;
  playedAt?: number;
}
```

**`src/game/gameStorage.ts`** — Add `source` and `importMetadata` fields to `PersistedGame`. Default `source: 'live'` for existing games.

**`src/profile/profileStore.ts`** — Add `linkedAccounts` to the profile:
```typescript
interface LinkedAccounts {
  chesscom: string | null;  // username
  lichess: string | null;   // username
}
```

**`supabase/schema.sql`** — Migration to add `source`, `external_id`, `import_metadata` columns to `games` table and `linked_accounts` to `profiles`.

## Step 2: PGN Import Engine

**New file: `src/game/pgnImport.ts`**
- `importPgnToTree(pgn: string, metadata: ImportMetadata): GameTree` — uses `chess.js.loadPgn()` to parse PGN, walks the move list, and builds a `GameTree` with all `MoveNode`s (analysis fields left null)
- Parses PGN headers for player names, Elo, result, time control, date
- Determines `humanColor` by matching the linked username against White/Black headers

## Step 3: Server-Side Import Proxy

**New file: `api/import-games.ts`** (Vercel Edge Runtime)
- `POST /api/import-games` with body `{ platform: 'chesscom' | 'lichess', username: string, year: number, month: number }`
- For Chess.com: fetches `https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}` (JSON endpoint, returns array of game objects with `pgn` field + metadata)
- For Lichess: fetches `https://lichess.org/api/games/user/{username}?since={timestamp}&until={timestamp}&opening=true&pgnInJson=true` (NDJSON, parsed into game array)
- Returns a JSON array of `{ pgn, metadata }` objects
- Validates username format, caps results per request (e.g. 100 games)

**New file: `api/import-archives.ts`** (for Chess.com archive listing)
- `GET /api/import-archives?platform=chesscom&username={username}`
- Proxies Chess.com's `/pub/player/{username}/games/archives` to return available year/month pairs

## Step 4: Linked Accounts UI in Settings

**`src/pages/SettingsPage.tsx`** — Add a new "Linked Accounts" card:
- Two rows: Chess.com and Lichess, each with a text input for username and Link/Unlink button
- Linking just saves the username to `profileStore.linkedAccounts` (persisted to IndexedDB + Supabase)
- No OAuth — both platforms have public game APIs
- Visual confirmation: show a checkmark and the linked username

## Step 5: Import UI in Library Page

**`src/pages/LibraryPage.tsx`** — Add an "Import Games" section/button:
- If no accounts linked, prompt user to link in Settings
- If accounts linked, show an import dialog with:
  - Platform selector (Chess.com / Lichess)
  - Month/year picker (default to current month)
  - "Import" button that calls the proxy, parses PGNs, saves games locally
- Progress indicator during import (e.g. "Importing 23 games...")
- Deduplication: skip games where `(source, externalId)` already exists locally
- Imported games appear in the library with a Chess.com/Lichess badge

**Filter controls** — Add source filter to the library list (All / Live / Chess.com / Lichess) so users can browse by origin.

## Step 6: On-Demand Analysis for Imported Games

**`src/pages/GameReviewPage.tsx`** (the `/library/:gameId` route):
- For imported games that haven't been analyzed: show an "Analyze with Stockfish" button
- When clicked, walk the mainline move-by-move, run Stockfish eval on each position, classify quality, detect motifs
- Show a progress bar ("Analyzing move 12/38...")
- Once complete, save the enriched tree back to storage
- Coach explanations (template-based or LLM) become available per-move after analysis
- Since profile impact is separate, analysis results are **not** fed into `profileStore` weakness events or SRS cards

## Step 7: Game Review Display Tweaks

- Show imported game metadata (opponent name, ratings, time control, platform) in the review header
- Display the platform badge (Chess.com / Lichess icon) in game cards in the library
- Unanalyzed moves show "Not yet analyzed" in the coach panel instead of a quality badge

---

## External API Reference

### Chess.com (Public, no auth required)

| Endpoint | Purpose |
|---|---|
| `GET /pub/player/{username}/games/archives` | List available year/month archives |
| `GET /pub/player/{username}/games/{YYYY}/{MM}` | JSON array of games with `pgn` field |
| `GET /pub/player/{username}/games/{YYYY}/{MM}/pgn` | Raw multi-game PGN download |

Rate limit: ~300 requests/min. Known intermittent reliability issues.

### Lichess (Public, no auth required for public games)

| Endpoint | Purpose |
|---|---|
| `GET /api/games/user/{username}` | Export games (NDJSON or PGN, supports `since`/`until` timestamps) |
| `GET /api/game/{id}` | Export single game |

Supports query params: `evals`, `clocks`, `opening`, `pgnInJson`, `max`, `since`, `until`.

---

## Files Changed/Created Summary

| File | Action |
|---|---|
| `src/game/gameTree.ts` | Add `GameSource`, `ImportMetadata` types |
| `src/game/gameStorage.ts` | Add `source`, `importMetadata` to `PersistedGame` |
| `src/game/pgnImport.ts` | **New** — PGN-to-GameTree parser |
| `src/profile/profileStore.ts` | Add `linkedAccounts` field |
| `src/pages/SettingsPage.tsx` | Add Linked Accounts card |
| `src/pages/LibraryPage.tsx` | Add import UI, source filters, platform badges |
| `src/pages/GameReviewPage.tsx` | Add "Analyze" button for unanalyzed imports |
| `api/import-games.ts` | **New** — Edge proxy for Chess.com/Lichess |
| `api/import-archives.ts` | **New** — Chess.com archive listing proxy |
| `src/sync/remoteGameStore.ts` | Handle new columns in Supabase writes |
| `supabase/schema.sql` | Migration for new columns |

Each step is independently useful and testable. Recommended implementation order is Step 1 through Step 7 sequentially.
