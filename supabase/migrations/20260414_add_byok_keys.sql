-- Add byok_keys table for server-side BYOK API key storage.
-- One row per user. The key is stored as-is (plaintext) so the
-- client can fetch it on sign-in and use it for API calls.
-- RLS ensures each user can only access their own key.
-- Safe to re-run: uses IF NOT EXISTS.

create table if not exists public.byok_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.byok_keys enable row level security;

drop policy if exists "byok_keys_select_own" on public.byok_keys;
create policy "byok_keys_select_own" on public.byok_keys
  for select using (user_id = auth.uid());

drop policy if exists "byok_keys_insert_own" on public.byok_keys;
create policy "byok_keys_insert_own" on public.byok_keys
  for insert with check (user_id = auth.uid());

drop policy if exists "byok_keys_update_own" on public.byok_keys;
create policy "byok_keys_update_own" on public.byok_keys
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "byok_keys_delete_own" on public.byok_keys;
create policy "byok_keys_delete_own" on public.byok_keys
  for delete using (user_id = auth.uid());
