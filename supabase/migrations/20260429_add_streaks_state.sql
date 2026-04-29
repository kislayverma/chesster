-- Add streaks_state JSONB column to profiles table.
-- Stores daily streak and weekly goal data separately from
-- journey_state (which owns skill progression).
-- Safe to re-run: uses IF NOT EXISTS via a DO block.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'streaks_state'
  ) then
    alter table public.profiles
      add column streaks_state jsonb not null default '{}'::jsonb;
  end if;
end
$$;
