-- ============================================================================
-- CollabU — Feature schema: event completion + reports
-- Run AFTER schema.sql. Idempotent.
-- ============================================================================

alter table public.events
  add column if not exists completed_at timestamptz;

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'project', 'event')),
  target_id   uuid not null,
  reason      text not null,
  details     text,
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz not null default now()
);

create index if not exists reports_reporter_idx on public.reports (reporter_id);

alter table public.reports enable row level security;

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated using (reporter_id = auth.uid());

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

grant select, insert on public.reports to authenticated;