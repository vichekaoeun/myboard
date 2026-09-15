-- My Board — Sync schema (run once in the Supabase SQL editor)
-- One row per account: the row id IS the auth user id. Row Level Security means
-- a signed-in user can only read/write their own row, so each account has a
-- private board and nobody can touch anyone else's.

-- 1) Table
create table if not exists public.boards (
  id         text primary key,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text default current_user
);

-- 2) Lock it down: authenticated users only, and only their own row.
alter table public.boards enable row level security;

-- Drop any previous policies (older setups allowed anonymous access).
drop policy if exists "anon_select"     on public.boards;
drop policy if exists "anon_insert"     on public.boards;
drop policy if exists "anon_update"     on public.boards;
drop policy if exists "boards_select_own" on public.boards;
drop policy if exists "boards_insert_own" on public.boards;
drop policy if exists "boards_update_own" on public.boards;
drop policy if exists "boards_delete_own" on public.boards;

create policy "boards_select_own" on public.boards
  for select to authenticated using (id = auth.uid()::text);

create policy "boards_insert_own" on public.boards
  for insert to authenticated with check (id = auth.uid()::text);

create policy "boards_update_own" on public.boards
  for update to authenticated using (id = auth.uid()::text) with check (id = auth.uid()::text);

create policy "boards_delete_own" on public.boards
  for delete to authenticated using (id = auth.uid()::text);

-- 3) (Optional) live cross-device updates. Run this once; it errors harmlessly
--    if the table is already part of the publication.
-- alter publication supabase_realtime add table public.boards;
