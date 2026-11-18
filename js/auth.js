/*
 * CollabU authentication + protected-route gate.
 * Email/password + Google OAuth, with a full-screen gate that blocks the app
 * until a session exists. Exposes window.Auth.
 */
(function () {
  const cfg = window.COLLABU_CONFIG || {};
  let callbacks = { onEnter: null, onExit: null };
  let currentUser = null;
  let entered = false;
  let initializing = false;

  /* ------------------------------------------------------------- gate markup */

  const GATE_STYLE = `
    <style id="authGateStyle">
      body.auth-locked > *:not(#authGate):not(style):not(script) { display: none !important; }
      #authGate { font-family: 'Inter', system-ui, sans-serif; }
      #authGate .gate-input { width:100%; padding:.78rem 1rem; border-radius:.85rem;
        background:#F5F6F4; border:1px solid #e5e7eb; font-size:.875rem; outline:none; }
      #authGate .gate-input:focus { border-color:#111315; box-shadow:0 0 0 3px rgba(154,230,27,.25); }
      #authGate .gate-tab-active { background:#111315 !important; color:#fff !important; }
      #authGate .gate-btn-primary { background:#111315; color:#fff; }
      #authGate .gate-btn-primary:hover { background:#262a2e; }
      #authGate .gate-btn-primary:disabled { opacity:.6; cursor:wait; }
      @keyframes gateSpin { to { transform: rotate(360deg); } }
      #authGate .gate-spin { animation: gateSpin .8s linear infinite; }
    </style>`;

  function gateMarkup() {
    return `
      <div id="authGate" class="hidden fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
           style="background:radial-gradient(circle at 50% 0%, rgba(154,230,27,.28), rgba(17,19,21,.97) 55%), #111315;">
        <div class="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-white/10 p-6 sm:p-8 animate-in">
          <div class="flex items-center gap-2.5 mb-6">
            <svg class="w-9 h-9" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <path d="M18 3L31 10.5V25.5L18 33L5 25.5V10.5L18 3Z" fill="#111315"/>
              <path d="M18 3L31 10.5L18 18L5 10.5L18 3Z" fill="#9AE61B"/>
              <path d="M18 18L31 10.5V25.5L18 33V18Z" fill="#23272B"/>
              <path d="M18 18L5 10.5V25.5L18 33V18Z" fill="#65A30D"/>
              <circle cx="18" cy="18" r="3.2" fill="#FFFFFF"/>
            </svg>
            <div>
              <div class="text-xl font-extrabold tracking-tight text-charcoal">Collab<span class="text-limeu-dark">U</span></div>
              <div class="text-[11px] text-muted -mt-0.5">Where student ideas meet real teams</div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-1 p-1 bg-canvas rounded-xl mb-5">
            <button type="button" data-gate-tab="login" class="gate-tab gate-tab-active py-2 rounded-lg text-xs font-bold text-muted transition-colors">Log in</button>
            <button type="button" data-gate-tab="signup" class="gate-tab py-2 rounded-lg text-xs font-bold text-muted transition-colors">Sign up</button>
          </div>

          <div id="gateError" class="hidden mb-4 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700"></div>

          <form id="gateForm" class="space-y-3">
            <div id="gateNameWrap" class="hidden">
              <label class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Full name</label>
              <input id="gateName" class="gate-input" type="text" placeholder="Aarav Sharma" autocomplete="name" />
            </div>
            <div id="gateCollegeWrap" class="hidden">
              <label class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">College</label>
              <input id="gateCollege" class="gate-input" type="text" placeholder="Chandigarh University" autocomplete="organization" />
            </div>
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Email</label>
              <input id="gateEmail" class="gate-input" type="email" required placeholder="you@college.edu" autocomplete="email" />
            </div>
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Password</label>
              <input id="gatePassword" class="gate-input" type="password" required minlength="6" placeholder="At least 6 characters" autocomplete="current-password" />
            </div>
            <button type="submit" id="gateSubmit" class="gate-btn-primary w-full py-3 rounded-xl text-sm font-bold mt-1">Log in →</button>
          </form>

          <div class="flex items-center gap-3 my-5">
            <div class="h-px flex-1 bg-gray-200"></div>
            <span class="text-[11px] font-semibold text-muted">or</span>
            <div class="h-px flex-1 bg-gray-200"></div>
          </div>

          <button type="button" id="gateGoogle" class="w-full py-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-charcoal hover:bg-canvas flex items-center justify-center gap-2">
            <svg class="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>

          <p class="text-[11px] text-muted text-center mt-5 leading-relaxed">
            By continuing you agree to CollabU's community guidelines.
            Your data is protected by row-level security.
          </p>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ helpers */

  function setMode(mode) {
    const isSignup = mode === "signup";
    document.querySelectorAll("#authGate .gate-tab").forEach((b) => {
      b.classList.toggle("gate-tab-active", b.dataset.gateTab === mode);
    });
    document.getElementById("gateNameWrap").classList.toggle("hidden", !isSignup);
    document.getElementById("gateCollegeWrap").classList.toggle("hidden", !isSignup);
    document.getElementById("gateSubmit").textContent = isSignup ? "Create account →" : "Log in →";
    document.getElementById("gatePassword").autocomplete = isSignup ? "new-password" : "current-password";
    hideError();
  }

  function showError(message) {
    const el = document.getElementById("gateError");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideError() {
    const el = document.getElementById("gateError");
    if (el) el.classList.add("hidden");
  }

  function setBusy(busy) {
    const btn = document.getElementById("gateSubmit");
    if (!btn) return;
    btn.disabled = busy;
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = "Please wait…";
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
  }

  function injectGate() {
    if (document.getElementById("authGate")) return;
    document.body.insertAdjacentHTML("beforeend", GATE_STYLE + gateMarkup());
    document.body.classList.add("auth-locked");

    document.querySelectorAll("#authGate .gate-tab").forEach((b) => {
      b.addEventListener("click", () => setMode(b.dataset.gateTab));
    });
    document.getElementById("gateForm").addEventListener("submit", onSubmit);
    document.getElementById("gateGoogle").addEventListener("click", onGoogle);
  }

  async function onSubmit(event) {
    event.preventDefault();
    hideError();
    if (!window.sb || !window.sb.auth) {
      showError("Supabase is not configured. Edit js/config.js with your project URL and anon key.");
      return;
    }
    const mode = document.querySelector("#authGate .gate-tab-active").dataset.gateTab;
    const email = document.getElementById("gateEmail").value.trim();
    const password = document.getElementById("gatePassword").value;

    setBusy(true);
    try {
      if (mode === "signup") {
        const name = document.getElementById("gateName").value.trim();
        const college = document.getElementById("gateCollege").value.trim();
        const { data, error } = await window.sb.auth.signUp({
          email,
          password,
          options: { data: { name, college } }
        });
        if (error) throw error;
        if (!data.session) {
          setBusy(false);
          showError("Account created. Check your inbox to confirm your email, then log in.");
          setMode("login");
          return;
        }
      } else {
        const { error } = await window.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      setBusy(false);
    } catch (err) {
      setBusy(false);
      showError(err.message || "Something went wrong. Please try again.");
    }
  }

  async function onGoogle() {
    hideError();
    if (!window.sb || !window.sb.auth) {
      showError("Supabase is not configured. Edit js/config.js with your project URL and anon key.");
      return;
    }
    try {
      const { error } = await window.sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: cfg.GOOGLE_REDIRECT || window.location.origin }
      });
      if (error) throw error;
    } catch (err) {
      showError(err.message || "Google sign-in failed.");
    }
  }

  /* --------------------------------------------------------------- lifecycle */

  async function enterApp(user) {
    if (entered) return;
    entered = true;
    currentUser = user;
    hideGate();
    document.body.classList.remove("auth-locked");
    if (typeof callbacks.onEnter === "function") {
      await callbacks.onEnter(user);
    }
  }

  function exitApp() {
    entered = false;
    currentUser = null;
    document.body.classList.add("auth-locked");
    showGate();
    if (typeof callbacks.onExit === "function") callbacks.onExit();
  }

  function showGate() {
    injectGate();
    const gate = document.getElementById("authGate");
    if (gate) gate.classList.remove("hidden");
  }

  function hideGate() {
    const gate = document.getElementById("authGate");
    if (gate) gate.classList.add("hidden");
  }

  async function init(options) {
    callbacks = Object.assign({ onEnter: null, onExit: null }, options || {});
    if (initializing) return;
    initializing = true;

    showGate();

    if (!window.sb || !window.sb.auth) {
      showError("Supabase is not configured. Edit js/config.js with your project URL and anon key.");
      return;
    }

    window.sb.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        enterApp(session.user);
      } else if (event === "SIGNED_OUT") {
        exitApp();
      }
    });

    const { data } = await window.sb.auth.getSession();
    if (data && data.session && data.session.user) {
      await enterApp(data.session.user);
    } else {
      showGate();
    }
  }

  async function signOut() {
    await window.sb.auth.signOut();
  }

  window.Auth = {
    init,
    signOut,
    isAuthenticated: () => !!currentUser,
    getUser: () => currentUser,
    show: showGate,
    hide: hideGate,
    setMode
  };
})();