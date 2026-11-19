-- ============================================================================
-- CollabU — GitHub Team Streak Challenge
-- Run AFTER schema.sql. Idempotent.
--
-- Rules implemented:
--   * A team streak grows when at least 60% of eligible members push/PR that UTC day.
--   * 3 Streak Saves per team prevent a break; once exhausted, the challenge ends.
--   * New members are eligible 24h after joining.
--   * "Valid activity" = a commit to the shared repo's default branch or a PR
--     created in that repo (GitHub GraphQL contributions).
-- ============================================================================

do $$ begin create extension if not exists pg_net; exception when others then null; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then null; end $$;

-- ----------------------------------------------------------------------------
-- GitHub connection (token is private; clients get column-limited access)
-- ----------------------------------------------------------------------------
create table if not exists public.github_connections (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  github_id    bigint,
  github_login text not null,
  avatar_url   text,
  access_token text not null,
  token_scope  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists github_connections_login_idx
  on public.github_connections (lower(github_login));

-- ----------------------------------------------------------------------------
-- Challenge teams
-- ----------------------------------------------------------------------------
create table if not exists public.challenge_teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  repo_full_name text not null,
  invite_code    text not null unique,
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  streak_days    integer not null default 0,
  best_streak    integer not null default 0,
  streak_saves   integer not null default 3,
  status         text not null default 'active' check (status in ('active', 'ended')),
  last_evaluated date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists challenge_teams_owner_idx on public.challenge_teams (owner_id);

-- ----------------------------------------------------------------------------
-- Members
-- ----------------------------------------------------------------------------
create table if not exists public.challenge_members (
  team_id      uuid not null references public.challenge_teams (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  github_login text,
  joined_at    timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists challenge_members_user_idx on public.challenge_members (user_id);

-- ----------------------------------------------------------------------------
-- Per-member daily status
-- ----------------------------------------------------------------------------
create table if not exists public.challenge_member_days (
  team_id    uuid not null references public.challenge_teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  pushed     boolean not null default false,
  commits    integer not null default 0,
  prs        integer not null default 0,
  checked_at timestamptz not null default now(),
  primary key (team_id, user_id, day)
);

create index if not exists challenge_member_days_team_idx
  on public.challenge_member_days (team_id, day);

-- ----------------------------------------------------------------------------
-- Per-team daily evaluation
-- ----------------------------------------------------------------------------
create table if not exists public.challenge_days (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.challenge_teams (id) on delete cascade,
  day          date not null,
  pushed_count integer not null default 0,
  member_count integer not null default 0,
  quorum       integer not null default 0,
  quorum_met   boolean not null default false,
  save_used    boolean not null default false,
  streak_after integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (team_id, day)
);

create index if not exists challenge_days_team_idx on public.challenge_days (team_id, day desc);

-- ----------------------------------------------------------------------------
-- Activity log
-- ----------------------------------------------------------------------------
create table if not exists public.challenge_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.challenge_teams (id) on delete cascade,
  type       text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

create index if not exists challenge_events_team_idx
  on public.challenge_events (team_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Private secrets (cron -> Edge Function auth). Service role only.
-- ----------------------------------------------------------------------------
create table if not exists public.app_secrets (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.github_connections    enable row level security;
alter table public.challenge_teams       enable row level security;
alter table public.challenge_members     enable row level security;
alter table public.challenge_member_days enable row level security;
alter table public.challenge_days        enable row level security;
alter table public.challenge_events      enable row level security;
alter table public.app_secrets           enable row level security;

-- github_connections: owner only
drop policy if exists gh_conn_select_own on public.github_connections;
create policy gh_conn_select_own on public.github_connections
  for select to authenticated using (user_id = auth.uid());

drop policy if exists gh_conn_insert_own on public.github_connections;
create policy gh_conn_insert_own on public.github_connections
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists gh_conn_update_own on public.github_connections;
create policy gh_conn_update_own on public.github_connections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- challenge_teams: owner or member
drop policy if exists ct_select on public.challenge_teams;
create policy ct_select on public.challenge_teams
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.challenge_members m
      where m.team_id = challenge_teams.id and m.user_id = auth.uid()
    )
  );

drop policy if exists ct_insert_own on public.challenge_teams;
create policy ct_insert_own on public.challenge_teams
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists ct_update_own on public.challenge_teams;
create policy ct_update_own on public.challenge_teams
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- challenge_members: members/owner can read; writes go through RPCs
drop policy if exists cm_select on public.challenge_members;
create policy cm_select on public.challenge_members
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.challenge_teams t
      where t.id = challenge_members.team_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.challenge_members m2
            where m2.team_id = challenge_members.team_id and m2.user_id = auth.uid()
          )
        )
    )
  );

-- challenge_member_days: team members/owner
drop policy if exists cmd_select on public.challenge_member_days;
create policy cmd_select on public.challenge_member_days
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.challenge_members m
      where m.team_id = challenge_member_days.team_id and m.user_id = auth.uid()
    )
  );

-- challenge_days: team members/owner
drop policy if exists cd_select on public.challenge_days;
create policy cd_select on public.challenge_days
  for select to authenticated using (
    exists (
      select 1 from public.challenge_members m
      where m.team_id = challenge_days.team_id and m.user_id = auth.uid()
    )
  );

-- challenge_events: team members/owner
drop policy if exists ce_select on public.challenge_events;
create policy ce_select on public.challenge_events
  for select to authenticated using (
    exists (
      select 1 from public.challenge_members m
      where m.team_id = challenge_events.team_id and m.user_id = auth.uid()
    )
  );

-- app_secrets: intentionally no policies (service role only)

-- ============================================================================
-- Grants
-- ============================================================================
grant select, insert, update, delete on
  public.challenge_teams, public.challenge_members, public.challenge_member_days,
  public.challenge_days, public.challenge_events
to authenticated;

-- Hide the OAuth token column from clients.
revoke all on public.github_connections from authenticated;
grant select (user_id, github_id, github_login, avatar_url, token_scope, created_at, updated_at)
  on public.github_connections to authenticated;
grant insert (user_id, github_id, github_login, avatar_url, access_token, token_scope)
  on public.github_connections to authenticated;
grant update (github_id, github_login, avatar_url, access_token, token_scope, updated_at)
  on public.github_connections to authenticated;

-- Keep updated_at fresh.
drop trigger if exists trg_github_connections_updated on public.github_connections;
create trigger trg_github_connections_updated
  before update on public.github_connections
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_challenge_teams_updated on public.challenge_teams;
create trigger trg_challenge_teams_updated
  before update on public.challenge_teams
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RPCs
-- ============================================================================
create or replace function public.create_challenge_team(p_name text, p_repo text)
returns public.challenge_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_repo text := lower(trim(p_repo));
  v_code text;
  v_login text;
  v_team public.challenge_teams;
begin
  if v_name = '' or v_repo = '' then
    raise exception 'Team name and repository are required';
  end if;
  if v_repo !~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$' then
    raise exception 'Repository must look like owner/repo';
  end if;
  if not exists (select 1 from public.github_connections where user_id = auth.uid()) then
    raise exception 'Connect your GitHub account first';
  end if;

  select github_login into v_login from public.github_connections where user_id = auth.uid();

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.challenge_teams where invite_code = v_code);
  end loop;

  insert into public.challenge_teams (name, repo_full_name, invite_code, owner_id)
  values (v_name, v_repo, v_code, auth.uid())
  returning * into v_team;

  insert into public.challenge_members (team_id, user_id, github_login)
  values (v_team.id, auth.uid(), v_login);

  insert into public.challenge_events (team_id, type, message)
  values (v_team.id, 'created', 'Team created by ' || coalesce(v_login, 'a student'));

  return v_team;
end;
$$;

create or replace function public.join_challenge_team(p_code text)
returns public.challenge_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_code));
  v_team public.challenge_teams;
  v_login text;
begin
  select * into v_team
  from public.challenge_teams
  where invite_code = v_code and status = 'active';

  if v_team.id is null then
    raise exception 'Invalid or ended invite code';
  end if;

  if exists (select 1 from public.challenge_members where team_id = v_team.id and user_id = auth.uid()) then
    return v_team;
  end if;

  if not exists (select 1 from public.github_connections where user_id = auth.uid()) then
    raise exception 'Connect your GitHub account first';
  end if;

  select github_login into v_login from public.github_connections where user_id = auth.uid();

  insert into public.challenge_members (team_id, user_id, github_login)
  values (v_team.id, auth.uid(), v_login);

  insert into public.challenge_events (team_id, type, message)
  values (v_team.id, 'joined', coalesce(v_login, 'A student') || ' joined the challenge');

  return v_team;
end;
$$;

create or replace function public.leave_challenge_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.challenge_members
  where team_id = p_team and user_id = auth.uid();
end;
$$;

grant execute on function public.create_challenge_team(text, text) to authenticated;
grant execute on function public.join_challenge_team(text) to authenticated;
grant execute on function public.leave_challenge_team(uuid) to authenticated;

-- ============================================================================
-- Cron -> Edge Function triggers
-- ============================================================================
create or replace function public.trigger_streak_evaluation()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.app_secrets where name = 'streak_secret';
  if v_secret is null then return; end if;

  perform net.http_post(
    url := 'https://ffxgsnwbraangtxxukgt.supabase.co/functions/v1/streak-evaluate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-streak-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

create or replace function public.trigger_streak_reminder()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.app_secrets where name = 'streak_secret';
  if v_secret is null then return; end if;

  perform net.http_post(
    url := 'https://ffxgsnwbraangtxxukgt.supabase.co/functions/v1/streak-remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-streak-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- ============================================================================
-- Schedules (00:10 UTC evaluation, 20:00 UTC reminder)
-- ============================================================================
do $$
begin
  perform cron.unschedule('collabu-streak-evaluate');
exception when others then null;
end $$;

do $$
begin
  perform cron.schedule(
    'collabu-streak-evaluate',
    '10 0 * * *',
    'select public.trigger_streak_evaluation();'
  );
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('collabu-streak-remind');
exception when others then null;
end $$;

do $$
begin
  perform cron.schedule(
    'collabu-streak-remind',
    '0 20 * * *',
    'select public.trigger_streak_reminder();'
  );
exception when others then null;
end $$;

-- ============================================================================
-- Realtime
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'challenge_teams', 'challenge_members', 'challenge_member_days',
    'challenge_days', 'challenge_events'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then
      null;
    end;
  end loop;
end $$;

-- ============================================================================
-- DONE. Generate a streak_secret into app_secrets, then deploy the
-- streak-evaluate and streak-remind Edge Functions with --no-verify-jwt.
-- ============================================================================