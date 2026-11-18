/*
 * Supabase client bootstrap.
 * Exposes `window.sb` (a SupabaseClient) for every other module.
 */
(function () {
  const cfg = window.COLLABU_CONFIG || {};

  // Capture OAuth / recovery state before supabase-js consumes the URL.
  try {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") === "recovery") {
      window.__COLLABU_RECOVERY__ = true;
    }
    const desc = params.get("error_description") || hash.get("error_description");
    const err = params.get("error") || hash.get("error");
    if (desc || err) {
      window.__COLLABU_OAUTH_ERROR__ = /provider|not enabled|unsupported/i.test(desc || "")
        ? "Google login is not enabled yet. Use email and password for now."
        : desc || "Login failed. Please try again.";
      history.replaceState(null, "", window.location.pathname);
    }
  } catch (_) {}

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