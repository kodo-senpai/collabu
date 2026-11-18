# CollabU — Setup Status

## Cloud backend (live)

| Item | Value |
| --- | --- |
| Supabase project | `collabu` |
| Project ref | `ffxgsnwbraangtxxukgt` |
| Region | `ap-northeast-1` |
| Plan | Free |
| API URL | `https://ffxgsnwbraangtxxukgt.supabase.co` |
| Anon key | Configured in `js/config.js` (public key; RLS protects data) |
| Service role / PAT | Never committed to this repo |

## What is deployed in Supabase

- 15 tables with Row Level Security enabled:
  `profiles`, `projects`, `project_members`, `project_tasks`, `project_messages`,
  `project_resources`, `applications`, `saved_items`, `notifications`, `events`,
  `event_rsvps`, `communities`, `community_members`, `blocks`, `connections`.
- Triggers: profile creation on signup, creator membership + kickoff task,
  `updated_at` maintenance, community member counts.
- RPC: `notify_user()` for cross-user notifications.
- Storage buckets: `avatars`, `project-images` (public read, user-scoped writes).
- Realtime publication: 12 tables.
- Seed: 4 communities, 3 events.
- Demo content: none. The database starts clean; the first real signup creates
  the first profile, project, and workspace.

## Local app

- URL: `http://localhost:3000` (static server)
- Entry point: `index.html`
- Runtime config: `js/config.js`

## Verified end-to-end

- Email/password login via the official `supabase-js` client.
- All 15 REST tables return the expected rows under RLS.
- Nested selects work (`applications → projects`).
- The `handle_new_user` trigger created the profile with correct initials.
- Demo projects loaded correctly during verification, then were removed for
  production. The database now contains zero users and zero projects.

## Public deployment (Vercel)

- Production URL: `https://collabu-orpin.vercel.app`
- Project: `shiori6/collabu`
- GitHub auto-deploy: connected (`kodo-senpai/collabu`, production branch `main`).
- Supabase Auth: configured — Site URL = `https://collabu-orpin.vercel.app`,
  redirects include `https://collabu-orpin.vercel.app/**`.

## Not configured yet

- Google OAuth (requires a Google Cloud OAuth client + Supabase Google provider).

## Next steps

1. Configure Google OAuth in Supabase if you want social login.
2. Create your real account through the app (the database is clean).
3. Note: Supabase free projects pause after 7 days of inactivity; open the
   dashboard to restore.