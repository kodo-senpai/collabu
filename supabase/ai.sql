-- ============================================================================
-- CollabU — AI response cache
-- Run AFTER schema.sql.
-- ============================================================================

create table if not exists public.ai_cache (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_cache enable row level security;

drop policy if exists ai_cache_select on public.ai_cache;
create policy ai_cache_select on public.ai_cache
  for select to authenticated using (true);

drop policy if exists ai_cache_insert on public.ai_cache;
create policy ai_cache_insert on public.ai_cache
  for insert to authenticated with check (true);

drop policy if exists ai_cache_update on public.ai_cache;
create policy ai_cache_update on public.ai_cache
  for update to authenticated using (true) with check (true);

grant select, insert, update on public.ai_cache to authenticated;