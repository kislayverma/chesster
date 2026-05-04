# Tribes — Product Specification

## Objective

Enable users to learn chess together in small, intimate groups that drive accountability, consistency, shared learning, and motivation through visible progress.

This feature transforms altmove from a solo learning tool into a shared improvement experience.

> altmove solves: "How do I learn better?"
> Tribes solves: **"How do I stay consistent?"**

---

## Design Principles

- Keep groups **small and meaningful** (max 4)
- Focus on **learning, not chatting**
- Encourage **accountability, not competition**
- Make progress **visible and shared**
- Respect **individual privacy** with configurable visibility

---

## 1. Tribe Structure

- Max size: **4 members** (creator + 3 invitees)
- Private, invite-only
- Single owner (creator) + members
- Free tier: 1 tribe per user
- Paid tier: multiple tribes per user

### Ownership & Lifecycle

- Owner can rename tribe, change emoji/description, or delete the tribe
- Owner can transfer ownership to another member
- Any member can leave at any time
- If the owner leaves, ownership transfers to the earliest remaining member
- If the last member leaves, the tribe is deleted
- Deleted tribes are soft-deleted (data retained 30 days for recovery)

---

## 2. Invitation Flow

### Entry Point

```
Start a tribe

Invite up to 3 friends
Learn together
Stay consistent
```

### Mechanics

- Owner invites by entering an email address
- System sends an email with a join link: `/tribes/join?token=<token>`
- If the invitee doesn't have an altmove account, the join link routes through sign-up first, then auto-joins
- Invite states: `pending` → `accepted` / `expired` / `declined`
- Invites expire after 7 days
- Owner can see pending invites and revoke them
- Max 3 outstanding invites per tribe (since max capacity is 4 including owner)

### Copy Options for Invite Email

- "Don't learn chess alone"
- "Improve together"
- "Build your learning circle"

---

## 3. Configurable Visibility

Each member controls what their tribemates can see. Privacy settings are per-user and global (not per-tribe).

### Always Visible (minimum for the tribe to function)

- Display name
- Journey level (e.g., "Club Player")
- Current streak (number only)
- Active status ("Active today" / "Last active 2 days ago")
- Weekly Focus area (system-derived, see Section 5B)

### Shareable (on by default, user can toggle off)

- Rolling rating
- Level progress bar (% to next level)
- Weekly goals progress (games and reviews)
- Longest streak
- Total games played
- Recent rating trend (sparkline of last 20 games)
- Phase ratings (opening / middlegame / endgame)
- Promotion history (milestones with dates)

### Private (off by default, user can toggle on)

- Top weaknesses (motif labels)
- ACPL history
- Opening insights (best/worst openings)

### Never Shared (not toggleable)

- Individual game trees / PGNs
- Full weakness event log (exact positions, moves)
- Practice card deck and schedule
- BYOK API key

Settings are managed in a "Tribe Visibility" card on the Settings page.

---

## 4. Tribe Dashboard

Route: `/tribes/:tribeId`

### Header

Tribe name, emoji, member count (e.g., "3/4"), settings gear (owner only).

### Member Cards (2x2 grid on desktop, stacked on mobile)

Each card shows:

```
Aman → Club Player (72%)     [streak flame if active today]
This week's focus: Avoid hanging pieces
Weekly: 3/5 games | 7/10 reviews
```

- Stats rendered based on that member's visibility settings
- Hidden stats are simply absent (no "hidden" label)
- Quick-react button on each card

### Tribe Streak Banner

```
Tribe streak: 5 days of learning together
```

Displayed prominently when active. Shows the collective streak count.

### Activity Feed (below member cards)

Chronological list of auto-generated events from all members (last 30 days, paginated):

- "Aman reached Club Player level"
- "Riya hit a 14-day streak"
- "You completed your weekly game goal"
- "Aman's rating reached 1400"
- "Riya shared a moment: missed fork on move 23"

Each feed item supports reactions and (for Shared Moments) comments.

---

## 5. Core Features

### A. Shared Progress Dashboard

Each member's journey is visible at a glance:

```
Aman → Club Player (72%)
Riya → Learner (45%)
You  → Learner (60%)
```

**Purpose:** Creates awareness, builds accountability, encourages consistency.

### B. Weekly Focus

Each member has a system-derived focus area displayed on their tribe card:

```
This week:
You  → Avoid hanging pieces
Aman → Improve tactics
Riya → Opening basics
```

**Derived from:** Individual weakness profile — the motif with the highest decayed count, or the game phase with the worst ACPL, mapped to a human-readable focus label.

**Refreshed:** Every Monday at midnight (user's local time). Persisted in the profile so it's stable for the week.

**Purpose:** Gives direction, makes progress structured, gives tribemates something concrete to encourage.

### C. Tribe Streaks

A collective streak that only increments when **all** members are active on a given day.

**Rules:**
- "Active" = played at least 1 game OR reviewed at least 1 mistake
- Incremented at end-of-day (UTC) if all members were active
- Reset if any member misses a day
- Displayed on the tribe dashboard as a shared badge

**Purpose:** Shared responsibility. One member's inactivity affects everyone — gentle social pressure without being punitive.

### D. Shared Moments

Members can share a specific position from their games with the tribe:

```
Kislay missed a fork on move 23

[View position]  [Try the best move]
```

**What can be shared:** Any analyzed position from the player's games — typically mistakes and blunders, but also brilliant moves.

**Interactions:**
- **View position** — opens a read-only board showing the position
- **Try the best move** — interactive: tribemate tries to find the correct move (like a mini-drill)
- **Comment** — short, contextual comments scoped to that moment only (not a chat feed)

**Comment rules:**
- Max 200 characters per comment
- Only available on Shared Moments (not on other feed items — those get reactions only)
- No threading, no replies — flat list under the moment

**Sharing flow:** From the game review page (`/library/:gameId`), on any analyzed move, a "Share to tribe" button appears. Player picks which tribe (if multiple). The moment appears in that tribe's feed.

**Purpose:** Learn from each other's mistakes, increase engagement, reinforce concepts through interactive replay.

### E. Tribe Insights

System analyzes aggregate patterns across all tribe members:

```
Your tribe struggles with:

  Tactical awareness (3/4 members)
  Mid-game planning (2/4 members)

Suggested: Practice forks together
```

**How it works:** Compare each member's top 3 weakness motifs. Surface motifs that appear in 2+ members' weakness profiles. Generate a suggested action from the shared motif.

**Visibility:** Only shown if at least 2 members have their weakness data set to shareable. If too few members share, show: "Enable weakness sharing in Settings to unlock tribe insights."

**Refresh:** Recomputed weekly alongside Weekly Focus.

**Tier:** Paid feature. Free tier shows a teaser ("Unlock tribe insights to see shared patterns").

**Purpose:** Makes learning collaborative, surfaces shared weaknesses, suggests focused practice.

### F. Activity Nudges

Lightweight prompts shown to a member when they haven't been active:

```
You haven't reviewed your mistakes today.
Your tribe is active — jump in!
```

**Rules:**
- Shown only on the altmove home page (not email, not push notifications — v1 is in-app only)
- Max 1 nudge per day
- Only shown if at least 1 other tribe member has been active today
- Not shown if the user has already been active today

**Purpose:** Gentle push toward engagement using social proof ("your tribe is active").

---

## 6. Reactions & Comments

### Reactions

Any member can react to feed items or directly to another member's card.

Curated set (4 reactions):

| Reaction | Emoji | Use Case |
|---|---|---|
| Fist bump | :fist: | General encouragement |
| Fire | :fire: | Impressive achievement |
| Crown | :crown: | Level up / promotion |
| Clap | :clap: | Goal completed |

**Rules:**
- One reaction per person per feed item (can change, not stack)
- Reactions visible to all tribe members
- Available on all feed items

### Comments (Moments Only)

- Short text comments (max 200 chars) allowed only on Shared Moments
- Contextual and learning-focused ("I missed the same pattern last week!")
- No threading, flat list
- Not available on other feed item types (streak milestones, level-ups, etc.)

### Notification Dot

- A dot appears on the Tribes nav item when someone reacts to your activity or comments on your moment
- Cleared when the user visits the tribe page

---

## 7. Milestone Events (Auto-Generated Feed Items)

The system detects these milestones and creates feed entries:

| Event | Trigger |
|---|---|
| Level promotion | Player advances to next journey level |
| Streak record | Player beats their personal longest streak |
| Weekly goal complete | All weekly game/review targets met |
| Rating milestone | Rating crosses a round number (1000, 1100, ...) |
| Game count milestone | 10th, 25th, 50th, 100th game |
| Weakness conquered | A motif drops below the "conquered" threshold |
| Moment shared | Player shares a position with the tribe |
| Member joined | New member accepts invite |

Generated server-side when profile data is written. Stored in the tribe feed table.

---

## 8. Navigation & Entry Points

- New **Tribes** item in NavShell (between Library and Profile)
- Notification dot on Tribes nav when there are unread reactions/comments
- `/tribes` — list of user's tribes + "Create a tribe" CTA
- `/tribes/:tribeId` — tribe dashboard
- `/tribes/join?token=...` — invite acceptance page
- Profile page gets a small "Tribes" section showing tribe memberships
- Settings page gets a "Tribe Visibility" card for privacy toggles
- Game review page gets a "Share to tribe" button on analyzed moves

### Auth Requirement

Tribes require authentication. Anonymous users see the Tribes nav item but are prompted to sign in.

### User Journey

```
User joins altmove
  → Plays games
  → Gets calibrated level
  → Prompt to create/join tribe (shown after level calibration)
  → Invites friends
  → Shares moments
  → Tracks group progress
  → Improves consistently
```

---

## 9. Monetization

### Free Tier

- 1 tribe
- Shared progress dashboard
- Weekly focus
- Tribe streaks
- Reactions on feed items
- Activity nudges

### Paid Tier

- Multiple tribes (up to 5)
- Tribe Insights (aggregate weakness analysis)
- Shared Moments with "Try the best move" interaction
- Comments on moments
- Priority invite delivery

### Upgrade Prompts

- When user tries to create a second tribe: "Upgrade to create multiple tribes"
- On tribe dashboard where Insights would appear: "Unlock tribe insights"
- When trying to share a moment on free tier: "Share moments with your tribe — upgrade"

---

## 10. Anti-Patterns to Avoid

- **Large groups** — leads to noise, reduces accountability
- **Generic chat** — low value, distracting, off-topic
- **Rating-based competition** — discouraging for beginners. No leaderboards, no ranking members against each other
- **Forced sharing** — always visible data is minimal. Players control what they reveal
- **Notification spam** — max 1 nudge/day, in-app only, no email/push in v1

---

## 11. Data Model (Supabase)

### New Tables

```sql
-- Tribes
create table public.tribes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 30),
  emoji text,                              -- single emoji, optional
  description text check (char_length(description) <= 100),
  owner_id uuid not null references auth.users(id) on delete cascade,
  tribe_streak int not null default 0,
  tribe_streak_last_date text,             -- YYYY-MM-DD, last date all members were active
  created_at timestamptz not null default now(),
  deleted_at timestamptz                   -- soft delete
);

-- Tribe Members
create table public.tribe_members (
  tribe_id uuid not null references public.tribes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (tribe_id, user_id)
);

-- Tribe Invites
create table public.tribe_invites (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'declined')),
  token text not null unique,              -- URL-safe, used in join link
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- Activity Feed
create table public.tribe_feed (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,                -- 'level_up', 'streak_record', 'goal_complete',
                                           -- 'rating_milestone', 'game_milestone',
                                           -- 'weakness_conquered', 'moment_shared', 'member_joined'
  event_data jsonb not null default '{}'::jsonb,
                                           -- level name, streak count, rating, FEN, etc.
  created_at timestamptz not null default now()
);
create index tribe_feed_tribe_created_idx on public.tribe_feed (tribe_id, created_at desc);

-- Reactions
create table public.tribe_reactions (
  id uuid primary key default gen_random_uuid(),
  feed_item_id uuid not null references public.tribe_feed(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('fist_bump', 'fire', 'crown', 'clap')),
  created_at timestamptz not null default now(),
  unique (feed_item_id, user_id)           -- one reaction per person per item
);

-- Comments (on Shared Moments only)
create table public.tribe_comments (
  id uuid primary key default gen_random_uuid(),
  feed_item_id uuid not null references public.tribe_feed(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index tribe_comments_feed_idx on public.tribe_comments (feed_item_id, created_at asc);

-- Shared Moments (position data for "Try the best move")
create table public.tribe_moments (
  id uuid primary key default gen_random_uuid(),
  feed_item_id uuid not null references public.tribe_feed(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null,
  fen text not null,                       -- position before the move
  player_move text not null,               -- SAN of what the player played
  best_move text not null,                 -- SAN of the engine's best move
  best_move_uci text not null,             -- UCI for board interaction
  quality text not null,                   -- 'mistake', 'blunder', etc.
  motifs text[] not null default '{}',
  move_number int not null,
  mover_color text not null check (mover_color in ('w', 'b')),
  created_at timestamptz not null default now()
);
```

### Extended Tables

```sql
-- Add visibility settings and weekly focus to profiles
alter table public.profiles
  add column visibility_settings jsonb not null
    default '{"rating":true,"levelProgress":true,"weeklyGoals":true,"longestStreak":true,"totalGames":true,"ratingTrend":true,"phaseRatings":true,"promotionHistory":true,"weaknesses":false,"acplHistory":false,"openingInsights":false}'::jsonb,
  add column weekly_focus jsonb
    default null;  -- {motifId, label, weekStartDate}
```

### RLS Policies

All tribe tables use membership-based policies:
- A user can read tribe data only if they are a member of that tribe
- `tribe_invites`: the `token`-based join endpoint uses a service-role function (like `migrate-anonymous.ts`) to bypass membership check for the accept action
- Feed, reactions, comments, and moments inherit tribe membership check via join on `tribe_feed.tribe_id`

---

## 12. Technical Notes

### Real-Time

Use Supabase Realtime channels for the activity feed:
- Channel: `tribe:{tribeId}:feed`
- Subscribe on tribe page mount, unsubscribe on unmount
- New feed items, reactions, and comments push to subscribers in real-time
- This is the first use of Supabase Realtime in altmove

### Weekly Focus Computation

Runs client-side when profile aggregation fires (existing 500ms debounce). Picks the motif with the highest `decayedCount` and maps it to a human-readable label. Persisted in `profiles.weekly_focus` so it's stable across sessions. Recomputed when `weekStartDate` changes (Monday rollover).

### Tribe Streak Computation

Evaluated server-side via a scheduled Supabase Edge Function or triggered on profile write:
1. Check if all tribe members have `lastActiveDate === today`
2. If yes and `tribe_streak_last_date !== today`: increment `tribe_streak`, update `tribe_streak_last_date`
3. If any member's `lastActiveDate < yesterday`: reset `tribe_streak` to 0

### Tribe Insights Computation (Paid Tier)

Runs server-side (Edge Function or on-demand API call):
1. Fetch all tribe members' `motifCounts` (only those with `visibility_settings.weaknesses = true`)
2. Find motifs appearing in 2+ members' top 5 by `decayedCount`
3. Return shared weakness labels + suggested action

### Feed Item Generation

Feed items are created as a side effect of profile writes. When the sync orchestrator pushes a profile update to Supabase, a database trigger (or the write endpoint) compares old vs. new state and inserts feed items for detected milestones:
- `journey_state.currentLevel` changed → `level_up`
- `streaks_state.currentStreak > longestStreak` → `streak_record`
- `streaks_state.weeklyGamesPlayed >= weeklyGameTarget` → `goal_complete`
- `journey_state.rollingRating` crosses a 100-point boundary → `rating_milestone`
- `totalGames` hits 10/25/50/100/... → `game_milestone`
- A motif's `decayedCount` drops below 0.5 → `weakness_conquered`

---

## 13. Implementation Phases

### Phase A: Foundation
- Data model (types, Supabase tables, RLS)
- Tribe CRUD (create, rename, delete, leave)
- Email invite flow (send, accept, expire, decline)
- `/tribes` list page + `/tribes/:tribeId` dashboard shell
- NavShell integration

### Phase B: Shared Dashboard
- Member cards with journey level, streak, weekly goals
- Visibility settings in Settings page
- Privacy-aware rendering (show/hide based on each member's settings)

### Phase C: Activity Feed & Reactions
- Milestone detection on profile write
- Feed rendering with pagination
- Reaction buttons (4 types)
- Notification dot on nav
- Supabase Realtime subscription

### Phase D: Weekly Focus & Tribe Streaks
- Weekly focus computation + persistence
- Focus label on member cards
- Tribe streak computation (server-side)
- Tribe streak banner on dashboard

### Phase E: Shared Moments
- "Share to tribe" button on game review page
- Moment storage (FEN, moves, motifs)
- Position viewer (read-only board)
- "Try the best move" interaction
- Comments on moments

### Phase F: Tribe Insights (Paid)
- Aggregate weakness analysis across members
- Suggested actions
- Paid tier gate + upgrade prompts

### Phase G: Activity Nudges
- In-app nudge on home page
- "Your tribe is active" social proof
- Max 1/day, only when others are active and user is not
