/*
 * Supabase client bootstrap.
 * Exposes `window.sb` (a SupabaseClient) for every other module.
 */
(function () {
  const cfg = window.COLLABU_CONFIG || {};

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("[CollabU] Supabase CDN failed to load. Check your internet connection.");
    return;
  }

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf("YOUR-PROJECT-REF") !== -1) {
    console.warn("[CollabU] SUPABASE_URL is not configured yet. Open js/config.js.");
  }

  window.sb = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "collabu.auth"
      },
      global: {
        headers: { "x-application-name": "collabu" }
      }
    }
  );
})();