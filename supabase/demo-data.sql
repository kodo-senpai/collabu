-- ============================================================================
-- CollabU — Optional demo content
-- Run only if you want sample projects to explore immediately.
-- It attaches demo projects to the FIRST profile that exists. If no user has
-- signed up yet, it does nothing. Safe to run multiple times.
-- ============================================================================

do $$
declare
  v_uid uuid;
  v_college text;
  v_name text;
begin
  select id, college, name into v_uid, v_college, v_name
  from public.profiles
  order by created_at
  limit 1;

  if v_uid is null then
    raise notice 'No profiles found. Sign up first, then re-run demo-data.sql.';
    return;
  end if;

  -- Project 1
  if not exists (select 1 from public.projects p where p.creator_id = v_uid and p.title = 'SmarterCampus') then
    with p as (
      insert into public.projects (num, title, tagline, description, category, type, commitment, college,
        cross_college, creator_id, skills, needed_roles, team_size, featured)
      values ('01', 'SmarterCampus', 'AI-powered scheduling and campus hub.',
        'An intelligent cross-campus timetable, smart study-room finder, and peer tutoring assistant powered by lightweight LLMs and calendar sync.',
        'AI & ML', 'Startup', 'Part-time (5-10h/wk)', coalesce(nullif(v_college, ''), 'Chandigarh University'),
        true, v_uid, array['AI/ML', 'React', 'UI/UX', 'Python'], array['Frontend Dev', 'AI Engineer'], 4, true)
      returning id
    )
    insert into public.project_tasks (project_id, title, assignee_id, status)
    select id, 'Train Timetable ML', v_uid, 'In Progress' from p
    union all
    select id, 'React Calendar UI', v_uid, 'In Progress' from p
    union all
    select id, 'User Research Survey', v_uid, 'Done' from p;

    insert into public.project_resources (project_id, title, url, added_by)
    select p.id, 'GitHub Repository', 'https://github.com', v_uid
    from public.projects p
    where p.creator_id = v_uid and p.title = 'SmarterCampus';
  end if;

  -- Project 2
  if not exists (select 1 from public.projects p where p.creator_id = v_uid and p.title = 'EcoGo') then
    with p as (
      insert into public.projects (num, title, tagline, description, category, type, commitment, college,
        cross_college, creator_id, skills, needed_roles, team_size, featured)
      values ('02', 'EcoGo', 'Peer-to-peer sustainable ride-sharing.',
        'Verified student-only carpooling, EV scooter pooling, and carbon-credit rewards across nearby university campuses.',
        'Mobile & App', 'Startup', 'Serious / Long-term', coalesce(nullif(v_college, ''), 'NIT Trichy'),
        true, v_uid, array['React Native', 'Node.js', 'MongoDB', 'UI/UX'], array['Mobile Dev', 'Product Designer'], 4, true)
      returning id
    )
    insert into public.project_tasks (project_id, title, assignee_id, status)
    select id, 'Route Matching Algorithm', v_uid, 'In Progress' from p
    union all
    select id, 'Student ID Verification Flow', v_uid, 'To Do' from p;
  end if;

  -- Project 3
  if not exists (select 1 from public.projects p where p.creator_id = v_uid and p.title = 'AeroBot') then
    with p as (
      insert into public.projects (num, title, tagline, description, category, type, commitment, college,
        cross_college, creator_id, skills, needed_roles, team_size, featured)
      values ('03', 'AeroBot', 'Collaborative drone mapping project.',
        'Low-cost autonomous quadcopter using ROS2 and computer vision for precision agriculture and campus disaster mapping.',
        'Robotics & HW', 'Research Paper', 'Part-time (5-10h/wk)', coalesce(nullif(v_college, ''), 'BITS Pilani'),
        true, v_uid, array['Robotics', 'ROS', 'Python', 'Embedded C'], array['Hardware Engineer', 'Embedded Dev'], 5, true)
      returning id
    )
    insert into public.project_tasks (project_id, title, assignee_id, status)
    select id, 'LiDAR Sensor Calibration', v_uid, 'Done' from p
    union all
    select id, 'YOLOv8 Crop Anomaly Model', v_uid, 'In Progress' from p;
  end if;

  -- Project 4 (open, needs teammates)
  if not exists (select 1 from public.projects p where p.creator_id = v_uid and p.title = 'MedBrief AI') then
    insert into public.projects (num, title, tagline, description, category, type, commitment, college,
      cross_college, creator_id, skills, needed_roles, team_size, featured)
    values ('04', 'MedBrief AI', 'Multilingual clinical note summarizer for rural clinics.',
      'Hackathon-born NLP tool translating doctor voice notes into structured patient summaries in Hindi, Punjabi, and English.',
      'AI & ML', 'Hackathon', 'Weekend / Hackathon', coalesce(nullif(v_college, ''), 'Chandigarh University'),
      true, v_uid, array['Python', 'NLP', 'FastAPI', 'React'], array['Backend Dev', 'UI/UX Designer'], 4, false);
  end if;

  raise notice 'Demo data ensured for profile %', v_name;
end $$;