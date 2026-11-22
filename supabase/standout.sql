-- ============================================================================
-- CollabU — Standout features schema
-- Run AFTER schema.sql. Idempotent.
-- ============================================================================

-- Work-style profile fields (for smarter matching)
alter table public.profiles
  add column if not exists work_style      text not null default '',
  add column if not exists work_hours      text not null default '',
  add column if not exists leadership_style text not null default '';

-- Skill endorsements from teammates
create table if not exists public.skill_endorsements (
  id         uuid primary key default gen_random_uuid(),
  skill      text not null,
  from_user  uuid not null references public.profiles (id) on delete cascade,
  to_user    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (skill, from_user, to_user),
  check (from_user <> to_user)
);

create index if not exists skill_endorsements_to_idx on public.skill_endorsements (to_user);

alter table public.skill_endorsements enable row level security;

drop policy if exists se_select on public.skill_endorsements;
create policy se_select on public.skill_endorsements
  for select to authenticated using (true);

drop policy if exists se_insert_own on public.skill_endorsements;
create policy se_insert_own on public.skill_endorsements
  for insert to authenticated with check (from_user = auth.uid());

drop policy if exists se_delete_own on public.skill_endorsements;
create policy se_delete_own on public.skill_endorsements
  for delete to authenticated using (from_user = auth.uid());

grant select, insert, delete on public.skill_endorsements to authenticated;

-- Project updates / build log / team charter / retrospectives
create table if not exists public.project_updates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'update' check (kind in ('update', 'charter', 'retrospective')),
  text       text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_updates_project_idx
  on public.project_updates (project_id, created_at desc);

alter table public.project_updates enable row level security;

drop policy if exists pu_select on public.project_updates;
create policy pu_select on public.project_updates
  for select to authenticated using (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists pu_insert on public.project_updates;
create policy pu_insert on public.project_updates
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_project_collaborator(project_id, auth.uid())
  );

grant select, insert on public.project_updates to authenticated;

-- Opportunity board
create table if not exists public.opportunities (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  org         text not null default '',
  description text not null default '',
  category    text not null default 'Internship',
  contact_url text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.opportunities enable row level security;

drop policy if exists opp_select on public.opportunities;
create policy opp_select on public.opportunities
  for select to authenticated using (true);

drop policy if exists opp_insert on public.opportunities;
create policy opp_insert on public.opportunities
  for insert to authenticated with check (created_by = auth.uid());

grant select, insert on public.opportunities to authenticated;

-- Mentor office hours
create table if not exists public.office_hours (
  id         uuid primary key default gen_random_uuid(),
  mentor_id  uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  date       text not null default '',
  mode       text not null default 'Online',
  seats      integer not null default 5,
  created_at timestamptz not null default now()
);

create index if not exists office_hours_mentor_idx on public.office_hours (mentor_id);

alter table public.office_hours enable row level security;

drop policy if exists oh_select on public.office_hours;
create policy oh_select on public.office_hours
  for select to authenticated using (true);

drop policy if exists oh_insert on public.office_hours;
create policy oh_insert on public.office_hours
  for insert to authenticated with check (mentor_id = auth.uid());

grant select, insert on public.office_hours to authenticated;

create table if not exists public.office_hours_bookings (
  office_hour_id uuid not null references public.office_hours (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (office_hour_id, user_id)
);

alter table public.office_hours_bookings enable row level security;

drop policy if exists ohb_select on public.office_hours_bookings;
create policy ohb_select on public.office_hours_bookings
  for select to authenticated using (true);

drop policy if exists ohb_insert_own on public.office_hours_bookings;
create policy ohb_insert_own on public.office_hours_bookings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists ohb_delete_own on public.office_hours_bookings;
create policy ohb_delete_own on public.office_hours_bookings
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.office_hours_bookings to authenticated;

-- ============================================================================
-- DONE. The Edge Functions / client can now use these tables.
-- ============================================================================