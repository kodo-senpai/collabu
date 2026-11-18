-- ============================================================================
-- CollabU — Production PostgreSQL schema for Supabase
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- It is idempotent: safe to run multiple times.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles: 1:1 with auth.users. Created automatically by trigger on signup.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  name               text not null default '',
  initials           text not null default '',
  college            text not null default '',
  department         text not null default '',
  semester           text not null default '',
  role               text not null default 'Student',
  availability       text not null default 'Open to Collaborate',
  skills             text[] not null default '{}',
  interests          text[] not null default '{}',
  bio                text not null default '',
  achievements       text not null default '',
  avatar_url         text,
  verified           boolean not null default false,
  allow_cross_college boolean not null default true,
  show_edu_public    boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- projects / ideas
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  num           text,
  title         text not null,
  tagline       text not null default '',
  description   text not null default '',
  category      text not null default 'AI & ML',
  type          text not null default 'Startup',
  commitment    text not null default 'Part-time (5-10h/wk)',
  college       text not null default '',
  cross_college boolean not null default true,
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  skills        text[] not null default '{}',
  needed_roles  text[] not null default '{}',
  team_size     integer not null default 4 check (team_size > 0),
  image_url     text,
  featured      boolean not null default false,
  completed     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_creator_idx on public.projects (creator_id);
create index if not exists projects_created_idx on public.projects (created_at desc);

-- ----------------------------------------------------------------------------
-- project_members: many-to-many between projects and profiles
-- ----------------------------------------------------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'Member',
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx on public.project_members (user_id);

-- ----------------------------------------------------------------------------
-- project_tasks
-- ----------------------------------------------------------------------------
create table if not exists public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null,
  assignee_id uuid references public.profiles (id) on delete set null,
  status      text not null default 'To Do' check (status in ('To Do', 'In Progress', 'Done')),
  created_at  timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks (project_id);

-- ----------------------------------------------------------------------------
-- project_messages (workspace group chat)
-- ----------------------------------------------------------------------------
create table if not exists public.project_messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists project_messages_project_idx on public.project_messages (project_id, created_at);

-- ----------------------------------------------------------------------------
-- project_resources (shared links)
-- ----------------------------------------------------------------------------
create table if not exists public.project_resources (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title      text not null,
  url        text not null,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_resources_project_idx on public.project_resources (project_id);

-- ----------------------------------------------------------------------------
-- applications: join requests with role + pitch
-- ----------------------------------------------------------------------------
create table if not exists public.applications (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  applicant_id uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'Member',
  pitch        text not null default '',
  status       text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Rejected')),
  created_at   timestamptz not null default now(),
  unique (project_id, applicant_id)
);

create index if not exists applications_project_idx on public.applications (project_id);
create index if not exists applications_applicant_idx on public.applications (applicant_id);

-- ----------------------------------------------------------------------------
-- saved_items
-- ----------------------------------------------------------------------------
create table if not exists public.saved_items (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists saved_items_project_idx on public.saved_items (project_id);

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  text       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- events / hackathons
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  event_date   text not null default '',
  mode         text not null default 'Online / Campus',
  organizer_id uuid references public.profiles (id) on delete set null,
  tag          text not null default 'Hackathon',
  description  text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (created_at desc);

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ----------------------------------------------------------------------------
-- communities
-- ----------------------------------------------------------------------------
create table if not exists public.communities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  focus        text not null default '',
  member_count integer not null default 0,
  created_at   timestamptz not null default now()
);

create unique index if not exists communities_name_key on public.communities (lower(name));

create table if not exists public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- ----------------------------------------------------------------------------
-- blocks & connections (teammate finder)
-- ----------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.connections (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles (id) on delete cascade,
  to_user    uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);

-- ============================================================================
-- 2. HELPER FUNCTIONS (SECURITY DEFINER so RLS can call them without recursion)
-- ============================================================================

create or replace function public.is_project_member(pid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = pid and user_id = uid
  );
$$;

create or replace function public.is_project_creator(pid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects
    where id = pid and creator_id = uid
  );
$$;

create or replace function public.is_project_collaborator(pid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_project_member(pid, uid) or public.is_project_creator(pid, uid);
$$;

-- Send a notification to ANY user (bypasses the "own rows only" policy).
-- Grant execute to authenticated so clients can notify creators/applicants.
create or replace function public.notify_user(target_user uuid, body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user is null or coalesce(trim(body), '') = '' then
    return;
  end if;
  insert into public.notifications (user_id, text) values (target_user, body);
end;
$$;

-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================

-- 3a. Create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_initials text;
begin
  v_name := trim(regexp_replace(coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(new.email, 'student'), '@', 1)
  ), '[[:space:]]+', ' ', 'g'));
  v_initials := coalesce(
    nullif(new.raw_user_meta_data ->> 'initials', ''),
    upper(
      left(split_part(v_name, ' ', 1), 1) ||
      left(coalesce(nullif(split_part(v_name, ' ', 2), ''), ''), 1)
    )
  );

  insert into public.profiles (id, name, initials, college, avatar_url)
  values (
    new.id,
    v_name,
    v_initials,
    coalesce(new.raw_user_meta_data ->> 'college', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  -- Welcome notification
  insert into public.notifications (user_id, text)
  values (new.id, 'Welcome to CollabU! Complete your profile to unlock smart matching.');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3b. Creator automatically becomes the first project member.
create or replace function public.add_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.creator_id, 'Creator')
  on conflict do nothing;

  insert into public.project_tasks (project_id, title, assignee_id, status)
  values (new.id, 'Kickoff & Role Alignment', new.creator_id, 'To Do');

  insert into public.project_messages (project_id, sender_id, text)
  values (new.id, new.creator_id, 'Workspace created for ' || new.title || '!');

  return new;
end;
$$;

drop trigger if exists trg_add_creator_as_member on public.projects;
create trigger trg_add_creator_as_member
  after insert on public.projects
  for each row execute function public.add_creator_as_member();

-- 3c. Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- 3d. Keep community member_count in sync.
create or replace function public.sync_community_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.communities set member_count = member_count + 1 where id = new.community_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_community_count on public.community_members;
create trigger trg_community_count
  after insert or delete on public.community_members
  for each row execute function public.sync_community_count();

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_members     enable row level security;
alter table public.project_tasks       enable row level security;
alter table public.project_messages    enable row level security;
alter table public.project_resources   enable row level security;
alter table public.applications        enable row level security;
alter table public.saved_items         enable row level security;
alter table public.notifications       enable row level security;
alter table public.events              enable row level security;
alter table public.event_rsvps         enable row level security;
alter table public.communities         enable row level security;
alter table public.community_members   enable row level security;
alter table public.blocks              enable row level security;
alter table public.connections         enable row level security;

-- ---------------------------- profiles -------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete to authenticated using (id = auth.uid());

-- ---------------------------- projects -------------------------------------
drop policy if exists projects_select_auth on public.projects;
create policy projects_select_auth on public.projects
  for select to authenticated using (true);

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
  for insert to authenticated with check (creator_id = auth.uid());

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
  for update to authenticated using (creator_id = auth.uid()) with check (creator_id = auth.uid());

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
  for delete to authenticated using (creator_id = auth.uid());

-- ------------------------- project_members ---------------------------------
drop policy if exists members_select_auth on public.project_members;
create policy members_select_auth on public.project_members
  for select to authenticated using (true);

drop policy if exists members_insert on public.project_members;
create policy members_insert on public.project_members
  for insert to authenticated with check (
    public.is_project_creator(project_id, auth.uid())
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.applications a
        where a.project_id = project_id
          and a.applicant_id = auth.uid()
          and a.status = 'Accepted'
      )
    )
  );

drop policy if exists members_delete on public.project_members;
create policy members_delete on public.project_members
  for delete to authenticated using (
    public.is_project_creator(project_id, auth.uid()) or user_id = auth.uid()
  );

-- -------------------------- project_tasks ----------------------------------
drop policy if exists tasks_select on public.project_tasks;
create policy tasks_select on public.project_tasks
  for select to authenticated using (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists tasks_insert on public.project_tasks;
create policy tasks_insert on public.project_tasks
  for insert to authenticated with check (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists tasks_update on public.project_tasks;
create policy tasks_update on public.project_tasks
  for update to authenticated using (public.is_project_collaborator(project_id, auth.uid()))
  with check (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists tasks_delete on public.project_tasks;
create policy tasks_delete on public.project_tasks
  for delete to authenticated using (public.is_project_collaborator(project_id, auth.uid()));

-- ------------------------ project_messages -------------------------------
drop policy if exists messages_select on public.project_messages;
create policy messages_select on public.project_messages
  for select to authenticated using (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists messages_insert on public.project_messages;
create policy messages_insert on public.project_messages
  for insert to authenticated with check (
    sender_id = auth.uid() and public.is_project_collaborator(project_id, auth.uid())
  );

drop policy if exists messages_delete on public.project_messages;
create policy messages_delete on public.project_messages
  for delete to authenticated using (sender_id = auth.uid());

-- ----------------------- project_resources -------------------------------
drop policy if exists resources_select on public.project_resources;
create policy resources_select on public.project_resources
  for select to authenticated using (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists resources_insert on public.project_resources;
create policy resources_insert on public.project_resources
  for insert to authenticated with check (public.is_project_collaborator(project_id, auth.uid()));

drop policy if exists resources_delete on public.project_resources;
create policy resources_delete on public.project_resources
  for delete to authenticated using (public.is_project_collaborator(project_id, auth.uid()));

-- --------------------------- applications ----------------------------------
drop policy if exists apps_select on public.applications;
create policy apps_select on public.applications
  for select to authenticated using (
    applicant_id = auth.uid() or public.is_project_creator(project_id, auth.uid())
  );

drop policy if exists apps_insert_own on public.applications;
create policy apps_insert_own on public.applications
  for insert to authenticated with check (
    applicant_id = auth.uid()
    and not public.is_project_creator(project_id, auth.uid())
  );

drop policy if exists apps_update_creator on public.applications;
create policy apps_update_creator on public.applications
  for update to authenticated using (public.is_project_creator(project_id, auth.uid()))
  with check (public.is_project_creator(project_id, auth.uid()));

drop policy if exists apps_delete on public.applications;
create policy apps_delete on public.applications
  for delete to authenticated using (
    applicant_id = auth.uid() or public.is_project_creator(project_id, auth.uid())
  );

-- --------------------------- saved_items -----------------------------------
drop policy if exists saved_select_own on public.saved_items;
create policy saved_select_own on public.saved_items
  for select to authenticated using (user_id = auth.uid());

drop policy if exists saved_insert_own on public.saved_items;
create policy saved_insert_own on public.saved_items
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists saved_delete_own on public.saved_items;
create policy saved_delete_own on public.saved_items
  for delete to authenticated using (user_id = auth.uid());

-- -------------------------- notifications ----------------------------------
drop policy if exists notif_select_own on public.notifications;
create policy notif_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notif_insert_own on public.notifications;
create policy notif_insert_own on public.notifications
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notif_update_own on public.notifications;
create policy notif_update_own on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notif_delete_own on public.notifications;
create policy notif_delete_own on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- ----------------------------- events --------------------------------------
drop policy if exists events_select_auth on public.events;
create policy events_select_auth on public.events
  for select to authenticated using (true);

drop policy if exists events_insert_auth on public.events;
create policy events_insert_auth on public.events
  for insert to authenticated with check (organizer_id = auth.uid());

drop policy if exists events_update_own on public.events;
create policy events_update_own on public.events
  for update to authenticated using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());

drop policy if exists events_delete_own on public.events;
create policy events_delete_own on public.events
  for delete to authenticated using (organizer_id = auth.uid());

-- --------------------------- event_rsvps -----------------------------------
drop policy if exists rsvp_select_auth on public.event_rsvps;
create policy rsvp_select_auth on public.event_rsvps
  for select to authenticated using (true);

drop policy if exists rsvp_insert_own on public.event_rsvps;
create policy rsvp_insert_own on public.event_rsvps
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists rsvp_delete_own on public.event_rsvps;
create policy rsvp_delete_own on public.event_rsvps
  for delete to authenticated using (user_id = auth.uid());

-- --------------------------- communities -----------------------------------
drop policy if exists communities_select_auth on public.communities;
create policy communities_select_auth on public.communities
  for select to authenticated using (true);

drop policy if exists communities_insert_auth on public.communities;
create policy communities_insert_auth on public.communities
  for insert to authenticated with check (true);

drop policy if exists community_members_select_auth on public.community_members;
create policy community_members_select_auth on public.community_members
  for select to authenticated using (true);

drop policy if exists community_members_insert_own on public.community_members;
create policy community_members_insert_own on public.community_members
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists community_members_delete_own on public.community_members;
create policy community_members_delete_own on public.community_members
  for delete to authenticated using (user_id = auth.uid());

-- ----------------------------- blocks --------------------------------------
drop policy if exists blocks_select_own on public.blocks;
create policy blocks_select_own on public.blocks
  for select to authenticated using (blocker_id = auth.uid());

drop policy if exists blocks_insert_own on public.blocks;
create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists blocks_delete_own on public.blocks;
create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- --------------------------- connections -----------------------------------
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections
  for select to authenticated using (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists connections_insert_own on public.connections;
create policy connections_insert_own on public.connections
  for insert to authenticated with check (from_user = auth.uid());

drop policy if exists connections_update on public.connections;
create policy connections_update on public.connections
  for update to authenticated using (from_user = auth.uid() or to_user = auth.uid())
  with check (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists connections_delete on public.connections;
create policy connections_delete on public.connections
  for delete to authenticated using (from_user = auth.uid() or to_user = auth.uid());

-- ============================================================================
-- 5. GRANTS
-- ============================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.notify_user(uuid, text) to authenticated;

-- ============================================================================
-- 6. REALTIME
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_members', 'project_tasks', 'project_messages',
    'project_resources', 'applications', 'notifications', 'event_rsvps',
    'events', 'connections', 'communities', 'community_members'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then
      null; -- already a member, or publication missing on older projects
    end;
  end loop;
end $$;

-- ============================================================================
-- 7. STORAGE (avatars + project images)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', true)
on conflict (id) do nothing;

-- Public read for both buckets.
drop policy if exists storage_avatars_read on storage.objects;
create policy storage_avatars_read on storage.objects
  for select using (bucket_id in ('avatars', 'project-images'));

-- Authenticated users may upload into their own folder (folder name = user id).
drop policy if exists storage_avatars_write on storage.objects;
create policy storage_avatars_write on storage.objects
  for insert to authenticated with check (
    bucket_id in ('avatars', 'project-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists storage_avatars_update on storage.objects;
create policy storage_avatars_update on storage.objects
  for update to authenticated using (
    bucket_id in ('avatars', 'project-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists storage_avatars_delete on storage.objects;
create policy storage_avatars_delete on storage.objects
  for delete to authenticated using (
    bucket_id in ('avatars', 'project-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- DONE. Next: run supabase/seed.sql, then supabase/demo-data.sql (optional).
-- ============================================================================