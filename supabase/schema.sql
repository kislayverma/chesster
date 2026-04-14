-- altmove Supabase schema (Phase 9).
--
-- Run this once in the Supabase SQL editor after creating a new project.
-- It is idempotent: every statement uses `if not exists` / `create or
-- replace` so you can re-run it to patch in new indexes or policies
-- without dropping data.
--
-- Schema overview (mirrors DESIGN.md §12a):
--
--   profiles         one row per user, holds the scalar aggregates from
--                    PlayerProfile. The detailed event log lives in
--                    weakness_events.
--   games            one row per persisted game. The full tree (nodes,
--                    stackFrames) is stored inline as jsonb — matches
--                    the local SerializedGameTree shape so the round
--                    trip through Supabase is free.
--   weakness_events  append-only log of every inaccuracy/mistake/blunder.
--                    The client reconstructs aggregates from this log
--                    on download via profileAggregates.recomputeAggregates,
--                    so the server-side aggregates are just a fast path.
--   anon_claims      audit trail: which anon_id → user_id migrations
--                    have run. Primary key on anon_id makes the claim
--                    idempotent: replaying a migration is a no-op.
--
-- Row-Level Security:
--
--   Every user-scoped table has RLS enabled with policies of the form
--   `user_id = auth.uid()`. The browser uses the anon key and reads/
--   writes directly — no function proxy required. The only server
--   function that touches these tables is /api/migrate-anonymous,
--   which uses the service-role key to insert rows on behalf of the
--   newly-authenticated user in a single transaction.

-- =====================================================================
-- profiles
-- =====================================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_games int not null default 0,
  total_moves int not null default 0,
  motif_counts jsonb not null default '{}'::jsonb,
  phase_cp_loss jsonb not null default '{"opening":0,"middlegame":0,"endgame":0}'::jsonb,
  opening_weaknesses jsonb not null default '{}'::jsonb,
  acpl_history jsonb not null default '[]'::jsonb,
  journey_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (user_id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (user_id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using (user_id = auth.uid());

-- =====================================================================
-- games
-- =====================================================================

create table if not exists public.games (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  finished_at timestamptz,
  result text,
  mainline_plies int not null default 0,
  engine_enabled boolean not null default true,
  human_color text not null check (human_color in ('w','b')),
  tree jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists games_user_updated_idx
  on public.games (user_id, updated_at desc);

alter table public.games enable row level security;

drop policy if exists "games_select_own" on public.games;
create policy "games_select_own" on public.games
  for select using (user_id = auth.uid());

drop policy if exists "games_insert_own" on public.games;
create policy "games_insert_own" on public.games
  for insert with check (user_id = auth.uid());

drop policy if exists "games_update_own" on public.games;
create policy "games_update_own" on public.games
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "games_delete_own" on public.games;
create policy "games_delete_own" on public.games
  for delete using (user_id = auth.uid());

-- =====================================================================
-- weakness_events
-- =====================================================================

create table if not exists public.weakness_events (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null,
  move_number int not null,
  fen text not null,
  player_move text not null,
  best_move text not null,
  cp_loss int not null,
  quality text not null check (quality in ('inaccuracy','mistake','blunder')),
  phase text not null check (phase in ('opening','middlegame','endgame')),
  motifs text[] not null default '{}',
  eco text,
  color text not null check (color in ('white','black')),
  ts timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists weakness_events_user_ts_idx
  on public.weakness_events (user_id, ts desc);
create index if not exists weakness_events_user_phase_idx
  on public.weakness_events (user_id, phase);

alter table public.weakness_events enable row level security;

drop policy if exists "weakness_events_select_own" on public.weakness_events;
create policy "weakness_events_select_own" on public.weakness_events
  for select using (user_id = auth.uid());

drop policy if exists "weakness_events_insert_own" on public.weakness_events;
create policy "weakness_events_insert_own" on public.weakness_events
  for insert with check (user_id = auth.uid());

drop policy if exists "weakness_events_update_own" on public.weakness_events;
create policy "weakness_events_update_own" on public.weakness_events
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "weakness_events_delete_own" on public.weakness_events;
create policy "weakness_events_delete_own" on public.weakness_events
  for delete using (user_id = auth.uid());

-- =====================================================================
-- anon_claims
-- =====================================================================

create table if not exists public.anon_claims (
  anon_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  counts jsonb
);

create index if not exists anon_claims_user_idx
  on public.anon_claims (user_id);

alter table public.anon_claims enable row level security;

-- Users may READ their own claims (so the client can tell whether a
-- migration has already run for the current anon_id on some other
-- device). Inserts are done by the service-role client inside
-- /api/migrate-anonymous, so we do NOT grant insert/update/delete to
-- the authenticated role.
drop policy if exists "anon_claims_select_own" on public.anon_claims;
create policy "anon_claims_select_own" on public.anon_claims
  for select using (user_id = auth.uid());

-- =====================================================================
-- practice_cards  (placeholder for Phase 6 SRS)
-- =====================================================================
--
-- Shipped now so /api/migrate-anonymous doesn't need a schema bump
-- when Phase 6 lands. Columns mirror the shape the SM-2 scheduler is
-- expected to use in src/srs/types.ts.

create table if not exists public.practice_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null references public.weakness_events(id) on delete cascade,
  fen text not null,
  best_move text not null,
  ease_factor real not null default 2.5,
  interval_days real not null default 0,
  due_at timestamptz not null default now(),
  lapses int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists practice_cards_user_due_idx
  on public.practice_cards (user_id, due_at);

alter table public.practice_cards enable row level security;

drop policy if exists "practice_cards_select_own" on public.practice_cards;
create policy "practice_cards_select_own" on public.practice_cards
  for select using (user_id = auth.uid());

drop policy if exists "practice_cards_insert_own" on public.practice_cards;
create policy "practice_cards_insert_own" on public.practice_cards
  for insert with check (user_id = auth.uid());

drop policy if exists "practice_cards_update_own" on public.practice_cards;
create policy "practice_cards_update_own" on public.practice_cards
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "practice_cards_delete_own" on public.practice_cards;
create policy "practice_cards_delete_own" on public.practice_cards
  for delete using (user_id = auth.uid());
