/*
 * CollabU runtime configuration.
 * ------------------------------------------------------------------
 * 1. Create a Supabase project at https://supabase.com
 * 2. Copy Project Settings > API > Project URL and anon public key.
 * 3. Paste them below. The anon key is safe for the browser because
 *    Row Level Security is the real security boundary.
 */
window.COLLABU_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",

  // Google OAuth redirect (must match Supabase Auth > URL Configuration).
  GOOGLE_REDIRECT: window.location.origin,

  // Friendly display name for the app shell.
  APP_NAME: "CollabU"
};