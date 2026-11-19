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
- Seed: intentionally empty (no demo events or communities).
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

## Google OAuth

- Provider: enabled in Supabase.
- Client ID: `36492008200-a5f2cegibbrvp1r93ft986a7pojjq0v7.apps.googleusercontent.com`
- Authorized redirect URI (Google Cloud):
  `https://ffxgsnwbraangtxxukgt.supabase.co/auth/v1/callback`
- Verified: `GET /auth/v1/authorize?provider=google` returns 302 to
  `accounts.google.com` with the correct client ID and callback.

## GitHub Streak Challenge

- Tables: `github_connections`, `challenge_teams`, `challenge_members`,
  `challenge_member_days`, `challenge_days`, `challenge_events`, `app_secrets`.
- Edge Functions: `streak-evaluate` and `streak-remind` (ACTIVE), protected by a
  cron secret; `send-push` handles Web Push.
- Cron: evaluation at 00:10 UTC, reminder at 20:00 UTC.
- Rules: 60% quorum (no all-or-nothing), 3 Streak Saves, 24h new-member grace,
  commits/PRs in the shared repo count as valid activity.
- GitHub OAuth: enabled (client ID `Ov23liKtpXEwbAKvvdhr`).
- Verified: `GET /auth/v1/authorize?provider=github` returns 302 to `github.com`
  with the correct client ID and Supabase callback.

## Not configured yet

- Nothing required. Google and GitHub login are configured.

## Next steps

1. Test "Continue with Google" and "Continue with GitHub" in the browser.
2. Create your real account through the app (the database is clean).
3. Note: Supabase free projects pause after 7 days of inactivity; open the
   dashboard to restore.