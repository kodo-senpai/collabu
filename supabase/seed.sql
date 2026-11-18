-- ============================================================================
-- CollabU — Seed data (communities + events)
-- Run AFTER schema.sql. Safe to run multiple times.
-- ============================================================================

insert into public.communities (name, focus, member_count) values
  ('AI & Open-Source Builders', 'LLMs, Computer Vision, Kaggle, Research', 0),
  ('Campus Founders Circle', 'MVPs, Pitch Decks, Co-Founder Matching', 0),
  ('Robotics & Hardware Lab', 'ROS2, Drones, IoT, PCB Design', 0),
  ('Design & Creative Technologists', 'UI/UX, Figma, WebGL, Indie Games', 0)
on conflict (lower(name)) do nothing;

insert into public.events (title, event_date, mode, tag, description)
select v.title, v.event_date, v.mode, v.tag, v.description
from (values
  ('CollabU Cross-Campus Buildathon 2026', 'Dec 12–14, 2026', 'Online / Hybrid', 'Hackathon',
   '48-hour cross-university sprint to ship an MVP with teammates from at least 2 different colleges.'),
  ('Zero-to-One AI Agents Workshop', 'Nov 28, 2026', 'Online Live', 'Workshop',
   'Hands-on session building open-source RAG and multi-agent workflows with free-tier tools.'),
  ('Student Founders & Co-Founder Mixer', 'Dec 5, 2026', 'In-Person + Stream', 'Startup Pitch',
   'Pitch your campus idea in 3 minutes and meet engineering, design, and business co-founders.')
) as v(title, event_date, mode, tag, description)
where not exists (
  select 1 from public.events e where lower(e.title) = lower(v.title) and e.event_date = v.event_date
);