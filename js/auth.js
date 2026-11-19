/*
 * CollabU authentication + protected-route gate.
 * Production flow: login, signup, forgot password, password recovery, resend
 * confirmation, and Google OAuth. Exposes window.Auth.
 */
(function () {
  const cfg = window.COLLABU_CONFIG || {};
  let callbacks = { onEnter: null, onExit: null };
  let currentUser = null;
  let entered = false;
  let initializing = false;
  let recoveryMode = false;
  let currentMode = "login";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------ styles */

  const GATE_STYLE = `
    <style id="authGateStyle">
      body.auth-locked > *:not(#authGate):not(style):not(script) { display: none !important; }
      #authGate { font-family: 'Inter', system-ui, sans-serif; }
      #authGate .gate-input { width:100%; padding:.75rem 1rem; border-radius:.75rem;
        background:#F5F6F4; border:1px solid #e5e7eb; font-size:.875rem; outline:none; }
      #authGate .gate-input:focus { border-color:#111315; box-shadow:0 0 0 3px rgba(154,230,27,.25); }
      #authGate .gate-btn-primary { background:#111315; color:#fff; }
      #authGate .gate-btn-primary:hover { background:#262a2e; }
      #authGate .gate-btn-primary:disabled { opacity:.6; cursor:wait; }
      #authGate .gate-tab-active { background:#111315 !important; color:#fff !important; }
      #authGate .gate-link { color:#4d7c0f; font-weight:700; }
      #authGate .gate-link:hover { text-decoration:underline; }
      #authGate .gate-eye { position:absolute; right:10px; top:50%; transform:translateY(-50%);
        font-size:10px; font-weight:800; letter-spacing:.05em; text-transform:uppercase;
        color:#6b7280; padding:4px; border-radius:6px; }
      #authGate .gate-eye:hover { color:#111315; background:#f3f4f6; }
      #authGate .gate-strength-bar { height:4px; flex:1; border-radius:999px; background:#e5e7eb; transition:background .2s; }
      #authGate .gate-strength-bar.s1 { background:#ef4444; }
      #authGate .gate-strength-bar.s2 { background:#f59e0b; }
      #authGate .gate-strength-bar.s3 { background:#eab308; }
      #authGate .gate-strength-bar.s4 { background:#22c55e; }
      #authGate .gate-error { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; }
      #authGate .gate-info { background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; }
      @keyframes gateSpin { to { transform: rotate(360deg); } }
      #authGate .gate-spin { animation: gateSpin .8s linear infinite; }
    </style>`;

  /* ------------------------------------------------------------------ markup */

  const LOGO = `
    <svg class="w-9 h-9" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M18 3L31 10.5V25.5L18 33L5 25.5V10.5L18 3Z" fill="#111315"/>
      <path d="M18 3L31 10.5L18 18L5 10.5L18 3Z" fill="#9AE61B"/>
      <path d="M18 18L31 10.5V25.5L18 33V18Z" fill="#23272B"/>
      <path d="M18 18L5 10.5V25.5L18 33V18Z" fill="#65A30D"/>
      <circle cx="18" cy="18" r="3.2" fill="#FFFFFF"/>
    </svg>`;

  const GOOGLE_ICON = `
    <svg class="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>`;

  function eyeButton(id) {
    return `<button type="button" class="gate-eye" data-eye="${id}" aria-label="Show password">Show</button>`;
  }

  function passwordField(id, autocomplete, placeholder) {
    return `
      <div class="relative">
        <input id="${id}" class="gate-input pr-14" type="password" required minlength="8"
          autocomplete="${autocomplete}" placeholder="${placeholder}" />
        ${eyeButton(id)}
      </div>`;
  }

  function gateMarkup() {
    return `
      <div id="authGate" class="hidden fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
           style="background:radial-gradient(circle at 50% 0%, rgba(154,230,27,.28), rgba(17,19,21,.97) 55%), #111315;">
        <div class="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-white/10 p-6 sm:p-8 animate-in">
          <div class="flex items-center gap-2.5 mb-5">
            ${LOGO}
            <div>
              <div class="text-xl font-extrabold tracking-tight text-charcoal">Collab<span class="text-limeu-dark">U</span></div>
              <div class="text-[11px] text-muted -mt-0.5">Where student ideas meet real teams</div>
            </div>
          </div>

          <div id="gateTabs" class="grid grid-cols-2 gap-1 p-1 bg-canvas rounded-xl mb-4">
            <button type="button" data-gate-tab="login" class="gate-tab gate-tab-active py-2 rounded-lg text-xs font-bold text-muted transition-colors">Log in</button>
            <button type="button" data-gate-tab="signup" class="gate-tab py-2 rounded-lg text-xs font-bold text-muted transition-colors">Sign up</button>
          </div>

          <div id="gateError" class="hidden mb-4 px-3.5 py-2.5 rounded-xl text-xs font-medium" role="alert" aria-live="assertive"></div>
          <div id="gateInfo" class="hidden mb-4 px-3.5 py-2.5 rounded-xl text-xs font-medium" role="status" aria-live="polite"></div>

          <form id="loginForm" class="gate-form space-y-3">
            <div>
              <label for="loginEmail" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Email</label>
              <input id="loginEmail" class="gate-input" type="email" required inputmode="email" autocomplete="email" placeholder="you@college.edu" />
            </div>
            <div>
              <label for="loginPassword" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Password</label>
              ${passwordField("loginPassword", "current-password", "Your password")}
            </div>
            <div class="flex items-center justify-end">
              <button type="button" data-gate-go="forgot" class="gate-link text-[11px]">Forgot password?</button>
            </div>
            <button type="submit" class="gate-btn-primary w-full py-3 rounded-xl text-sm font-bold mt-1">Log in →</button>
          </form>

          <form id="signupForm" class="gate-form hidden space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label for="signupName" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Full name</label>
                <input id="signupName" class="gate-input" type="text" required autocomplete="name" placeholder="Aarav Sharma" />
              </div>
              <div>
                <label for="signupCollege" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">College</label>
                <input id="signupCollege" class="gate-input" type="text" required autocomplete="organization" placeholder="Your college" />
              </div>
            </div>
            <div>
              <label for="signupEmail" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Email</label>
              <input id="signupEmail" class="gate-input" type="email" required inputmode="email" autocomplete="email" placeholder="you@college.edu" />
            </div>
            <div>
              <label for="signupPassword" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Password</label>
              ${passwordField("signupPassword", "new-password", "At least 8 characters")}
              <div class="flex gap-1 mt-2" id="gateStrength">
                <span class="gate-strength-bar"></span>
                <span class="gate-strength-bar"></span>
                <span class="gate-strength-bar"></span>
                <span class="gate-strength-bar"></span>
              </div>
              <div id="gateStrengthLabel" class="text-[10px] text-muted mt-1">At least 8 characters with a number or symbol.</div>
            </div>
            <div>
              <label for="signupConfirm" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Confirm password</label>
              <input id="signupConfirm" class="gate-input" type="password" required minlength="8" autocomplete="new-password" placeholder="Repeat your password" />
            </div>
            <label class="flex items-start gap-2 text-[11px] text-muted cursor-pointer">
              <input id="signupTerms" type="checkbox" required class="mt-0.5 accent-charcoal" />
              <span>I agree to the <a href="#" onclick="event.preventDefault()" class="underline">community guidelines</a> and <a href="#" onclick="event.preventDefault()" class="underline">privacy policy</a>.</span>
            </label>
            <button type="submit" class="gate-btn-primary w-full py-3 rounded-xl text-sm font-bold mt-1">Create account →</button>
          </form>

          <form id="forgotForm" class="gate-form hidden space-y-3">
            <p class="text-xs text-muted">Enter your email and we'll send a password reset link.</p>
            <div>
              <label for="forgotEmail" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Email</label>
              <input id="forgotEmail" class="gate-input" type="email" required inputmode="email" autocomplete="email" placeholder="you@college.edu" />
            </div>
            <button type="submit" class="gate-btn-primary w-full py-3 rounded-xl text-sm font-bold mt-1">Send reset link →</button>
            <button type="button" data-gate-go="login" class="gate-link text-[11px] block mx-auto">Back to log in</button>
          </form>

          <form id="recoveryForm" class="gate-form hidden space-y-3">
            <p class="text-xs text-muted">Choose a new password for your account.</p>
            <div>
              <label for="recoveryPassword" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">New password</label>
              ${passwordField("recoveryPassword", "new-password", "At least 8 characters")}
            </div>
            <div>
              <label for="recoveryConfirm" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Confirm new password</label>
              <input id="recoveryConfirm" class="gate-input" type="password" required minlength="8" autocomplete="new-password" placeholder="Repeat your new password" />
            </div>
            <button type="submit" class="gate-btn-primary w-full py-3 rounded-xl text-sm font-bold mt-1">Update password →</button>
          </form>

          <form id="resendForm" class="gate-form hidden space-y-3">
            <p class="text-xs text-muted">Enter your email to resend the confirmation link.</p>
            <div>
              <label for="resendEmail" class="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Email</label>
              <input id="resendEmail" class="gate-input" type="email" required inputmode="email" autocomplete="email" placeholder="you@college.edu" />
            </div>
            <button type="submit" class="gate-btn-primary w-full py-3 rounded-xl text-sm font-bold mt-1">Resend confirmation →</button>
            <button type="button" data-gate-go="login" class="gate-link text-[11px] block mx-auto">Back to log in</button>
          </form>

          <div id="gateGoogleWrap">
            <div class="flex items-center gap-3 my-4">
              <div class="h-px flex-1 bg-gray-200"></div>
              <span class="text-[11px] font-semibold text-muted">or</span>
              <div class="h-px flex-1 bg-gray-200"></div>
            </div>
            <button type="button" id="gateGoogle" class="w-full py-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-charcoal hover:bg-canvas flex items-center justify-center gap-2">
              ${GOOGLE_ICON}
              <span id="gateGoogleLabel">Continue with Google</span>
            </button>
          </div>

          <p class="text-[11px] text-muted text-center mt-4 leading-relaxed">
            Your data is protected by Supabase Auth and row-level security.
          </p>
        </div>
      </div>`;
  }

  /* ----------------------------------------------------------------- helpers */

  function clearMessages() {
    ["gateError", "gateInfo"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = "";
      el.classList.add("hidden");
      el.classList.remove("gate-error", "gate-info");
    });
  }

  function showError(msg) {
    clearMessages();
    const el = document.getElementById("gateError");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    el.classList.add("gate-error");
  }

  function showInfo(msg) {
    clearMessages();
    const el = document.getElementById("gateInfo");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    el.classList.add("gate-info");
  }

  function setBusy(busy) {
    $$("#authGate button[type='submit']").forEach((btn) => {
      if (busy) {
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Please wait…";
      } else {
        btn.disabled = false;
        if (btn.dataset.label) {
          btn.textContent = btn.dataset.label;
          delete btn.dataset.label;
        }
      }
    });

    const google = document.getElementById("gateGoogle");
    if (google) {
      google.disabled = busy;
      const label = document.getElementById("gateGoogleLabel");
      if (label) label.textContent = busy ? "Connecting…" : "Continue with Google";
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function hasNumberOrSymbol(pw) {
    return /[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw);
  }

  function passwordScore(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }

  function updateStrength(pw) {
    const score = passwordScore(pw);
    $$("#gateStrength .gate-strength-bar").forEach((bar, i) => {
      bar.className = "gate-strength-bar";
      if (i < score) bar.classList.add("s" + score);
    });

    const label = document.getElementById("gateStrengthLabel");
    if (!label) return;
    if (!pw) label.textContent = "At least 8 characters with a number or symbol.";
    else if (score <= 1) label.textContent = "Weak — add length, numbers, or symbols.";
    else if (score === 2) label.textContent = "Fair — add another character type.";
    else if (score === 3) label.textContent = "Good password.";
    else label.textContent = "Strong password.";
  }

  function mapAuthError(err) {
    const raw = (err && (err.message || err.error_description)) || "Something went wrong. Please try again.";
    const msg = String(raw);
    const lower = msg.toLowerCase();

    if (lower.includes("invalid login credentials")) return "Email or password is incorrect.";
    if (lower.includes("email not confirmed")) return "Please confirm your email before logging in.";
    if (lower.includes("user already registered")) return "An account with this email already exists. Try logging in.";
    if (lower.includes("password should be at least")) return "Password must be at least 8 characters.";
    if (lower.includes("unable to validate email")) return "Please enter a valid email address.";
    if (lower.includes("signups not allowed")) return "New signups are currently disabled.";
    if (lower.includes("rate limit") || lower.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
    if (lower.includes("email address not authorized")) return "This email is not authorized to sign up.";
    if (lower.includes("provider is not enabled") || lower.includes("unsupported provider")) return "Google login is not enabled yet. Use email and password for now.";
    if (lower.includes("oauth") || lower.includes("provider")) return "Google login was cancelled or failed. Please try again.";
    return msg;
  }

  /* -------------------------------------------------------------------- modes */

  function setMode(mode) {
    const allowed = ["login", "signup", "forgot", "recovery", "resend"];
    if (!allowed.includes(mode)) mode = "login";
    currentMode = mode;

    const isAuth = mode === "login" || mode === "signup";

    const tabs = document.getElementById("gateTabs");
    if (tabs) tabs.classList.toggle("hidden", !isAuth);

    $$("#authGate .gate-tab").forEach((b) => {
      b.classList.toggle("gate-tab-active", b.dataset.gateTab === mode);
    });

    $$("#authGate .gate-form").forEach((f) => f.classList.add("hidden"));
    const form = document.getElementById(mode + "Form");
    if (form) form.classList.remove("hidden");

    const googleWrap = document.getElementById("gateGoogleWrap");
    if (googleWrap) googleWrap.classList.toggle("hidden", !isAuth);

    clearMessages();

    if (mode === "forgot" || mode === "resend") {
      const source = (document.getElementById("loginEmail") || {}).value || (document.getElementById("signupEmail") || {}).value;
      const target = document.getElementById(mode + "Email");
      if (target && source && !target.value) target.value = source;
    }

    const first = form && form.querySelector("input:not([type=checkbox])");
    if (first) setTimeout(() => first.focus(), 60);
  }

  /* ------------------------------------------------------------------ actions */

  async function onLogin(e) {
    e.preventDefault();
    clearMessages();

    const email = (document.getElementById("loginEmail") || {}).value.trim();
    const password = (document.getElementById("loginPassword") || {}).value;

    if (!isValidEmail(email)) return showError("Please enter a valid email address.");
    if (!password) return showError("Please enter your password.");

    setBusy(true);
    try {
      const { error } = await window.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setBusy(false);
    } catch (err) {
      setBusy(false);
      if (/email not confirmed/i.test(err.message || "")) {
        setMode("resend");
        const resendEmail = document.getElementById("resendEmail");
        if (resendEmail) resendEmail.value = email;
        showError("Please confirm your email first. Resend the confirmation email below.");
      } else {
        showError(mapAuthError(err));
      }
    }
  }

  async function onSignup(e) {
    e.preventDefault();
    clearMessages();

    const name = (document.getElementById("signupName") || {}).value.trim();
    const college = (document.getElementById("signupCollege") || {}).value.trim();
    const email = (document.getElementById("signupEmail") || {}).value.trim();
    const password = (document.getElementById("signupPassword") || {}).value;
    const confirm = (document.getElementById("signupConfirm") || {}).value;
    const terms = (document.getElementById("signupTerms") || {}).checked;

    if (!name) return showError("Please enter your full name.");
    if (!college) return showError("Please enter your college.");
    if (!isValidEmail(email)) return showError("Please enter a valid email address.");
    if (password.length < 8 || !hasNumberOrSymbol(password)) return showError("Use at least 8 characters with a number or symbol.");
    if (password !== confirm) return showError("Passwords do not match.");
    if (!terms) return showError("Please accept the community guidelines to continue.");

    setBusy(true);
    try {
      const { data, error } = await window.sb.auth.signUp({
        email,
        password,
        options: { data: { name, college }, emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      setBusy(false);

      if (!data.session) {
        setMode("resend");
        const resendEmail = document.getElementById("resendEmail");
        if (resendEmail) resendEmail.value = email;
        showInfo("Check your inbox to confirm your email. Didn't get it? Resend below.");
      }
    } catch (err) {
      setBusy(false);
      showError(mapAuthError(err));
    }
  }

  async function onForgot(e) {
    e.preventDefault();
    clearMessages();

    const email = (document.getElementById("forgotEmail") || {}).value.trim();
    if (!isValidEmail(email)) return showError("Please enter a valid email address.");

    setBusy(true);
    try {
      const { error } = await window.sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      if (error) throw error;
      setBusy(false);
      showInfo("If an account exists, a password reset link is on its way.");
    } catch (err) {
      setBusy(false);
      showError(mapAuthError(err));
    }
  }

  async function onRecovery(e) {
    e.preventDefault();
    clearMessages();

    const password = (document.getElementById("recoveryPassword") || {}).value;
    const confirm = (document.getElementById("recoveryConfirm") || {}).value;

    if (password.length < 8 || !hasNumberOrSymbol(password)) return showError("Use at least 8 characters with a number or symbol.");
    if (password !== confirm) return showError("Passwords do not match.");

    setBusy(true);
    try {
      const { error } = await window.sb.auth.updateUser({ password });
      if (error) throw error;

      recoveryMode = false;
      await window.sb.auth.signOut();
      setBusy(false);
      setMode("login");
      showInfo("Password updated. Log in with your new password.");
    } catch (err) {
      setBusy(false);
      showError(mapAuthError(err));
    }
  }

  async function onResend(e) {
    e.preventDefault();
    clearMessages();

    const email = (document.getElementById("resendEmail") || {}).value.trim();
    if (!isValidEmail(email)) return showError("Please enter a valid email address.");

    setBusy(true);
    try {
      const { error } = await window.sb.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      setBusy(false);
      showInfo("Confirmation email resent. Please check your inbox.");
    } catch (err) {
      setBusy(false);
      showError(mapAuthError(err));
    }
  }

  async function onGoogle() {
    clearMessages();
    setBusy(true);
    try {
      const { error } = await window.sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: cfg.GOOGLE_REDIRECT || window.location.origin,
          queryParams: { prompt: "select_account" }
        }
      });
      if (error) throw error;
    } catch (err) {
      setBusy(false);
      showError(mapAuthError(err));
    }
  }

  /* --------------------------------------------------------------- lifecycle */

  function injectGate() {
    if (document.getElementById("authGate")) return;

    document.body.insertAdjacentHTML("beforeend", GATE_STYLE + gateMarkup());
    document.body.classList.add("auth-locked");

    $$("#authGate .gate-tab").forEach((b) => {
      b.addEventListener("click", () => setMode(b.dataset.gateTab));
    });

    $$("#authGate [data-gate-go]").forEach((b) => {
      b.addEventListener("click", () => setMode(b.dataset.gateGo));
    });

    $$("#authGate .gate-eye").forEach((b) => {
      b.addEventListener("click", () => {
        const input = document.getElementById(b.dataset.eye);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        b.textContent = show ? "Hide" : "Show";
        b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      });
    });

    const loginForm = document.getElementById("loginForm");
    if (loginForm) loginForm.addEventListener("submit", onLogin);

    const signupForm = document.getElementById("signupForm");
    if (signupForm) signupForm.addEventListener("submit", onSignup);

    const forgotForm = document.getElementById("forgotForm");
    if (forgotForm) forgotForm.addEventListener("submit", onForgot);

    const recoveryForm = document.getElementById("recoveryForm");
    if (recoveryForm) recoveryForm.addEventListener("submit", onRecovery);

    const resendForm = document.getElementById("resendForm");
    if (resendForm) resendForm.addEventListener("submit", onResend);

    const signupPassword = document.getElementById("signupPassword");
    if (signupPassword) {
      signupPassword.addEventListener("input", (e) => updateStrength(e.target.value));
    }

    const google = document.getElementById("gateGoogle");
    if (google) google.addEventListener("click", onGoogle);
  }

  function showGate() {
    injectGate();
    const gate = document.getElementById("authGate");
    if (gate) gate.classList.remove("hidden");
    setMode(currentMode || "login");
  }

  function hideGate() {
    const gate = document.getElementById("authGate");
    if (gate) gate.classList.add("hidden");
  }

  async function enterApp(user) {
    if (entered) return;
    entered = true;
    currentUser = user;
    recoveryMode = false;
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
    setMode("login");
    if (typeof callbacks.onExit === "function") callbacks.onExit();
  }

  async function signOut() {
    try {
      await window.sb.auth.signOut();
    } catch (err) {
      console.error("[CollabU] signOut failed", err);
    }
  }

  async function init(options) {
    callbacks = Object.assign({ onEnter: null, onExit: null }, options || {});
    if (initializing) return;
    initializing = true;

    recoveryMode = !!window.__COLLABU_RECOVERY__;
    showGate();
    if (recoveryMode) setMode("recovery");

    if (!window.sb || !window.sb.auth) {
      showError("Supabase is not configured. Edit js/config.js with your project URL and anon key.");
      return;
    }

    window.sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;
        entered = false;
        document.body.classList.add("auth-locked");
        showGate();
        setMode("recovery");
        return;
      }

      if (session && session.user) {
        window.__COLLABU_SESSION__ = session;
        if (recoveryMode) return;
        enterApp(session.user);
      } else if (event === "SIGNED_OUT") {
        recoveryMode = false;
        exitApp();
      }
    });

    const { data } = await window.sb.auth.getSession();
    if (data && data.session && data.session.user) {
      window.__COLLABU_SESSION__ = data.session;
      if (!recoveryMode) await enterApp(data.session.user);
    } else {
      showGate();
    }

    if (window.__COLLABU_OAUTH_ERROR__) {
      showError(window.__COLLABU_OAUTH_ERROR__);
      delete window.__COLLABU_OAUTH_ERROR__;
    }
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