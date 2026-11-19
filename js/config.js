/*
 * CollabU runtime configuration.
 * ------------------------------------------------------------------
 * 1. Create a Supabase project at https://supabase.com
 * 2. Copy Project Settings > API > Project URL and anon public key.
 * 3. Paste them below. The anon key is safe for the browser because
 *    Row Level Security is the real security boundary.
 */
window.COLLABU_CONFIG = {
  SUPABASE_URL: "https://ffxgsnwbraangtxxukgt.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeGdzbndicmFhbmd0eHh1a2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMjM4NjksImV4cCI6MjExMDU5OTg2OX0.KOeFxJJfUGn3nuy3_71P3UdzIg1N4Gr9Ky3uxFaZ2Fo",

  // Google OAuth redirect (must match Supabase Auth > URL Configuration).
  GOOGLE_REDIRECT: window.location.origin,

  // Friendly display name for the app shell.
  APP_NAME: "CollabU",
  VAPID_PUBLIC_KEY: "BDAhQZ6WY02E37GWONkMCOrYMA9h0JX9zl8evvz5g5jyhHTwi5V3kpQoSPTelTrdO67pJ3E_eBVRqqyuyYM1qDg"
};