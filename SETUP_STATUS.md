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
- Demo content: 4 projects (`SmarterCampus`, `EcoGo`, `AeroBot`, `MedBrief AI`),
  11 tasks, 4 messages, 1 resource.

## Demo account

- Email: `demo@collabu.local`
- Password: shared in the setup chat (change it in Supabase → Authentication → Users)
- Profile: Aarav Sharma, Chandigarh University

## Local app

- URL: `http://localhost:3000` (static server)
- Entry point: `index.html`
- Runtime config: `js/config.js`

## Verified end-to-end

- Email/password login via the official `supabase-js` client.
- All 15 REST tables return the expected rows under RLS.
- Nested selects work (`applications → projects`).
- The `handle_new_user` trigger created the profile with correct initials.
- 4 demo projects load with members, tasks, messages, and resources.

## Not configured yet

- Google OAuth (requires a Google Cloud OAuth client + Supabase Google provider).
- Vercel deployment.
- GitHub remote push (needs the repository URL).

## Next steps

1. Change the demo password or delete the demo user before sharing the app publicly.
2. Configure Google OAuth in Supabase if you want social login.
3. Create a GitHub repository and push this repo.
4. Import the repo into Vercel (no build command) to get a public HTTPS URL.
5. Note: Supabase free projects pause after 7 days of inactivity; open the
   dashboard to restore.