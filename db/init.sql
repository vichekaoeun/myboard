-- My Board — Sync schema (run once in the Supabase SQL editor)
-- Single shared board row; anon may read/write that one row via open RLS.
-- Everything is keyed off one fixed row id (see src/supabase.js BOARD_ROW_ID).

-- 1) Table
create table if not exists public.boards (
  id        text primary key,
  payload   jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text default current_user
);

-- 2) Allow *anonymous* (no login) clients to read & write the single row.
--    This is a personal/public single-board demo: the row is the whole board.
--    Locked down later by switching RLS to auth-based when accounts are added.
alter table public.boards enable row level security;

drop policy if exists "anon_select"  on public.boards;
drop policy if exists "anon_insert"  on public.boards;
drop policy if exists "anon_update"  on public.boards;

create policy "anon_select" on public.boards
  for select to anon using (true);

create policy "anon_insert" on public.boards
  for insert to anon with check (true);

create policy "anon_update" on public.boards
  for update to anon using (true) with check (true);
