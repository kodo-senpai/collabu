/*
 * CollabU application shell.
 * ---------------------------------------------------------------------------
 * This file replaces the original LocalStorage prototype. `state` is now a
 * read-through cache hydrated from Supabase; every mutation calls window.API,
 * updates the cache, and re-renders. Realtime changes trigger a debounced
 * refresh. Inline onclick handlers keep working because all functions are
 * declared in the global scope of this classic script.
 */

/* ------------------------------------------------------------------ state */

const VALID_VIEWS = ["home", "explore", "teammates", "workspaces", "hackathons", "challenges", "dashboard"];

const state = {
  currentView: "home",
  activeWorkspaceId: null,
  activeWorkspaceTab: "chat",
  activeHackathonTab: "events",
  user: null,
  projects: [],
  students: [],
  events: [],
  communities: [],
  savedIds: [],
  applications: [],
  blockedIds: [],
  notifications: [],
  connections: [],
  blockedUsers: [],
  challenge: { loading: false, loaded: false, connection: null, team: null, members: [], days: [], events: [] },
  _renderedWsId: null,
  _knownMyProjectIds: new Set(),
  _initialized: false
};

let _refreshTimer = null;

/* ---------------------------------------------------------------- helpers */

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showToast(msg) {
  const el = document.getElementById("toast");
  const msgEl = document.getElementById("toastMsg");
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add("hidden"), 3400);
}

function toastError(err) {
  console.error("[CollabU]", err);
  const msg = (err && (err.message || err.error_description)) || "Please try again.";
  showToast("Something went wrong: " + msg);
}

function computeMatchScore(skillsList) {
  if (!state.user) return 72;
  const userSkills = (state.user.skills || []).map((s) => s.toLowerCase().trim());
  if (!skillsList || !skillsList.length) return 72;
  let hits = 0;
  skillsList.forEach((sk) => {
    const low = sk.toLowerCase();
    if (userSkills.some((u) => low.includes(u) || u.includes(low))) hits++;
  });
  return Math.min(98, Math.round(62 + (hits / skillsList.length) * 36));
}

/* --------------------------------------------------------------- shapers */

function shapeUser(p) {
  return {
    id: p.id,
    name: p.name || "Student",
    initials: p.initials || API.initialsOf(p.name),
    college: p.college || "",
    department: p.department || "",
    semester: p.semester || "",
    role: p.role || "Student",
    availability: p.availability || "Open to Collaborate",
    skills: p.skills || [],
    interests: p.interests || [],
    bio: p.bio || "",
    achievements: p.achievements || "",
    avatarUrl: p.avatar_url || "",
    verified: !!p.verified,
    allowCrossCollege: p.allow_cross_college !== false,
    showEduPublic: p.show_edu_public !== false
  };
}

function shapeStudent(p, projects) {
  const owned = (projects || []).filter(
    (pr) => pr.creatorId === p.id || (pr.memberIds || []).includes(p.id)
  ).length;
  const showEdu = p.show_edu_public !== false;
  return {
    id: p.id,
    name: p.name || "Student",
    initials: p.initials || API.initialsOf(p.name),
    college: showEdu ? p.college || "" : "Hidden",
    dept: showEdu ? p.department || "" : "",
    sem: showEdu ? p.semester || "" : "",
    role: p.role || "Student",
    availability: p.availability || "Open to Collaborate",
    avatarUrl: p.avatar_url || "",
    verified: !!p.verified,
    skills: p.skills || [],
    interests: p.interests || [],
    achievements: p.achievements || "",
    bio: p.bio || "",
    projectsCount: owned
  };
}

function myProjects() {
  if (!state.user) return [];
  return state.projects.filter(
    (p) => p.creatorId === state.user.id || (p.memberIds || []).includes(state.user.id)
  );
}

/* ------------------------------------------------------------ data access */

async function loadData() {
  const user = Auth.getUser();
  if (!user) throw new Error("Not authenticated");

const profiles = await API.listProfiles();
  const [profile, projects, savedIds, apps, notifs, blocked, events, communities, conns] = await Promise.all([
    API.ensureProfile(user.id, user.email),
    API.listProjects(profiles),
    API.listSavedIds(user.id),
    API.listMyApplications(user.id),
    API.listNotifications(user.id),
    API.listBlockedIds(user.id),
    API.listEvents(user.id),
    API.listCommunities(user.id),
    API.listConnections(user.id)
  ]);

  const myIds = projects
    .filter((p) => p.creatorId === user.id || p.memberIds.includes(user.id))
    .map((p) => p.id);
  const newMine = state._initialized
    ? myIds.filter((id) => !state._knownMyProjectIds.has(id))
    : [];

  state.user = shapeUser(profile || { id: user.id, name: user.email || "Student" });
  state.projects = projects;
  state.students = profiles
    .filter((p) => p.id !== user.id && !blocked.includes(p.id))
    .map((p) => shapeStudent(p, projects));
  state.savedIds = savedIds;
  state.applications = apps;
  state.notifications = notifs;
  state.blockedIds = blocked;
  state.events = events;
  state.communities = communities;
  state.connections = conns;
  state.blockedUsers = await API.listBlockedUsers(user.id);

  state._knownMyProjectIds = new Set(myIds);
  state._initialized = true;

  const mine = myProjects();
  if (!mine.some((p) => p.id === state.activeWorkspaceId)) {
    state.activeWorkspaceId = mine.length ? mine[0].id : (state.projects[0] ? state.projects[0].id : null);
  }

  if (newMine.length) {
    newMine.slice(0, 2).forEach((id) => {
      const p = projects.find((x) => x.id === id);
      if (p) showToast("You were added to " + p.title);
    });
  }
}

async function refreshAll() {
  await loadData();
  renderCurrentView();
}

function scheduleRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    refreshAll().catch((err) => console.error("[CollabU] refresh failed", err));
  }, 300);
}

/* --------------------------------------------------------------- routing */

function parseHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "").trim();
  return VALID_VIEWS.includes(raw) ? raw : "dashboard";
}

function applyView(view) {
  document.querySelectorAll(".view-section").forEach((s) => s.classList.add("hidden"));
  const target = document.getElementById("view-" + view);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-link-active", btn.dataset.nav === view);
  });

  if (typeof window.scrollTo === "function") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function navigateTo(view, skipHash) {
  if (!Auth.isAuthenticated()) {
    Auth.show();
    return;
  }
  if (!VALID_VIEWS.includes(view)) view = "dashboard";

  state.currentView = view;
  applyView(view);

  if (!skipHash && window.location.hash !== "#" + view) {
    history.pushState(null, "", "#" + view);
  }
  renderCurrentView();
}

function filterByDomain(domain) {
  navigateTo("explore");
  const sel = document.getElementById("exploreCategory");
  if (sel) {
    sel.value = domain;
    renderMarketplace();
  }
}

function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  if (menu) menu.classList.toggle("hidden");
}

/* --------------------------------------------------------------- loader */

function ensureLoader() {
  if (document.getElementById("appLoader")) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="appLoader" class="hidden fixed inset-0 z-[90] bg-canvas/80 backdrop-blur-sm flex items-center justify-center">
       <div class="flex flex-col items-center gap-3">
         <div class="w-10 h-10 rounded-full border-4 border-gray-200 border-t-charcoal animate-spin"></div>
         <div class="text-xs font-bold text-charcoal">Loading your workspace…</div>
       </div>
     </div>`
  );
}

function showLoader(show) {
  const el = document.getElementById("appLoader");
  if (el) el.classList.toggle("hidden", !show);
}

/* ------------------------------------------------------------ notifications */

function renderNotifications() {
  const badge = document.getElementById("notifBadge");
  const unread = state.notifications.filter((n) => !n.read).length;
  if (badge) {
    if (unread > 0) {
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  const list = document.getElementById("notifList");
  const dash = document.getElementById("dashNotifList");

  if (list) {
    list.innerHTML = state.notifications.length
      ? state.notifications
          .map(
            (n) => `
        <div class="px-4 py-3 text-xs ${n.read ? "bg-white" : "bg-limeu-soft/40"}">
          <div class="font-medium text-charcoal">${escapeHtml(n.text)}</div>
          <div class="text-[11px] text-muted mt-1">${escapeHtml(n.time)}</div>
        </div>`
          )
          .join("")
      : '<div class="p-4 text-xs text-muted text-center">No notifications yet.</div>';
  }

  if (dash) {
    dash.innerHTML = state.notifications.length
      ? state.notifications
          .map(
            (n) => `
        <div class="p-3 rounded-xl text-xs ${n.read ? "bg-canvas border border-gray-200" : "bg-limeu-soft/50 border border-limeu/30"}">
          <div class="font-medium text-charcoal">${escapeHtml(n.text)}</div>
          <div class="text-[11px] text-muted mt-0.5">${escapeHtml(n.time)}</div>
        </div>`
          )
          .join("")
      : '<div class="text-xs text-muted py-4 text-center">No notifications yet.</div>';
  }
}

function toggleNotifications() {
  const dd = document.getElementById("notifDropdown");
  if (dd) dd.classList.toggle("hidden");
}

async function markAllNotificationsRead() {
  try {
    await API.markAllNotificationsRead(state.user.id);
    state.notifications.forEach((n) => (n.read = true));
    renderNotifications();
  } catch (err) {
    toastError(err);
  }
}

/* --------------------------------------------------------------- renderers */

function getCollegeCounts() {
  const map = {};
  const add = (raw) => {
    const name = String(raw || "").trim();
    if (!name || name.toLowerCase() === "hidden") return;
    const key = name.toLowerCase();
    if (!map[key]) map[key] = { name, count: 0 };
    map[key].count += 1;
  };
  if (state.user && state.user.college) add(state.user.college);
  state.students.forEach((s) => add(s.college));
  const result = {};
  Object.values(map).forEach((v) => {
    result[v.name] = (result[v.name] || 0) + v.count;
  });
  return result;
}

function renderHomeStats() {
  const ideas = state.projects.length;
  const builders = state.students.length + (state.user ? 1 : 0);
  const colleges = getCollegeCounts();
  const collegeCount = Object.keys(colleges).length;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(value).toLocaleString();
  };
  setText("statIdeas", ideas);
  setText("statColleges", collegeCount);
  setText("statBuilders", builders);

  const strip = document.getElementById("collegeStrip");
  if (!strip) return;

  const entries = Object.entries(colleges)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  if (!entries.length) {
    strip.innerHTML = '<span class="text-muted">Your campus could be next.</span>';
    return;
  }

  strip.innerHTML = entries
    .map(
      ([name, count]) =>
        `<span class="flex items-center gap-1.5"><span class="w-5 h-5 rounded bg-gray-200/80 inline-flex items-center justify-center text-[10px]">🏛</span> ${escapeHtml(name)}${count > 1 ? ` <span class="text-limeu-dark">(${count})</span>` : ""}</span>`
    )
    .join("");
}

function renderHome() {
  renderHomeStats();

  const featured = state.projects.filter((p) => p.featured).slice(0, 3);
  const grid = document.getElementById("homeFeaturedGrid");
  if (!grid) return;

  if (!featured.length) {
    grid.innerHTML =
      '<div class="col-span-full bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-muted">No featured projects yet. Post the first idea!</div>';
    return;
  }

  grid.innerHTML = featured
    .map(
      (p) => `
      <div onclick="openProjectModal('${p.id}')" class="cursor-pointer bg-white rounded-2xl border border-gray-200/90 overflow-hidden shadow-sm hover:shadow-lg hover:border-limeu transition-all flex flex-col group">
        <div class="relative h-48 bg-canvas overflow-hidden">
          <span class="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur text-xs font-extrabold text-charcoal shadow-sm">${escapeHtml(p.num)}</span>
          ${p.image ? `<img src="${p.image}" alt="${escapeHtml(p.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />` : `<div class="w-full h-full flex items-center justify-center bg-limeu-soft text-limeu-dark font-black text-lg">${escapeHtml(p.category)}</div>`}
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-3">
          <div>
            <h3 class="font-extrabold text-lg text-charcoal">${escapeHtml(p.title)}</h3>
            <p class="text-xs text-muted mt-0.5">${escapeHtml(p.tagline)}</p>
            <div class="flex flex-wrap gap-1.5 mt-3">
              ${p.skills.slice(0, 3).map((s) => `<span class="px-2.5 py-0.5 rounded-full bg-canvas border border-gray-200 text-[11px] font-semibold text-charcoal">${escapeHtml(s)}</span>`).join("")}
            </div>
          </div>
          <div class="pt-3 border-t border-gray-100 text-[11px] text-muted">
            <span class="font-bold text-charcoal">Needed:</span> ${p.neededRoles.map((r) => escapeHtml(r)).join(", ")}
          </div>
        </div>
      </div>`
    )
    .join("");
}

function renderMarketplace() {
  const q = (document.getElementById("exploreSearch") || {}).value || "";
  const cat = (document.getElementById("exploreCategory") || {}).value || "All";
  const type = (document.getElementById("exploreType") || {}).value || "All";
  const sort = (document.getElementById("exploreSort") || {}).value || "match";
  const crossOnly = !!(document.getElementById("exploreCrossCollege") || {}).checked;
  const savedOnly = !!(document.getElementById("exploreSavedOnly") || {}).checked;
  const needle = q.toLowerCase();

  let list = state.projects.map((p) => Object.assign({}, p, { match: computeMatchScore(p.skills) }));

  list = list.filter((p) => {
    if (cat !== "All" && p.category !== cat) return false;
    if (type !== "All" && p.type !== type) return false;
    if (crossOnly && !p.crossCollege) return false;
    if (savedOnly && !state.savedIds.includes(p.id)) return false;
    if (needle) {
      const hay = [p.title, p.tagline, p.description, p.college, ...p.skills, ...p.neededRoles]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  if (sort === "match") list.sort((a, b) => b.match - a.match);
  else if (sort === "openings") list.sort((a, b) => (b.teamSize - b.members.length) - (a.teamSize - a.members.length));
  // "newest" keeps the API order (created_at desc)

  const count = document.getElementById("exploreCount");
  if (count) count.textContent = "Showing " + list.length + " project" + (list.length === 1 ? "" : "s");

  const grid = document.getElementById("marketplaceGrid");
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML =
      '<div class="col-span-full bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-muted">No matching projects found. Try broadening your filters or post your own idea!</div>';
    return;
  }

  grid.innerHTML = list
    .map((p) => {
      const isSaved = state.savedIds.includes(p.id);
      return `
      <div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm hover:shadow-md hover:border-limeu transition-all flex flex-col justify-between gap-4">
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2.5 py-1 rounded-full bg-canvas border border-gray-200 text-[11px] font-bold text-charcoal">${escapeHtml(p.category)} • ${escapeHtml(p.type)}</span>
            <div class="flex items-center gap-1.5">
              <span class="px-2.5 py-1 rounded-full bg-limeu-soft text-limeu-dark text-[11px] font-extrabold">${p.match}% Match</span>
              <button type="button" onclick="toggleSaveProject('${p.id}')" title="Save Idea" class="p-1.5 rounded-full hover:bg-canvas text-sm">${isSaved ? "🔖" : "📑"}</button>
            </div>
          </div>
          <div>
            <h3 class="font-extrabold text-lg text-charcoal">${escapeHtml(p.title)}</h3>
            <p class="text-xs text-muted mt-1 line-clamp-2">${escapeHtml(p.description)}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            ${p.skills.map((s) => `<span class="px-2 py-0.5 rounded-md bg-canvas text-[11px] font-medium text-charcoal">${escapeHtml(s)}</span>`).join("")}
          </div>
        </div>
        <div class="space-y-3 pt-3 border-t border-gray-100">
          <div class="flex items-center justify-between text-[11px] text-muted">
            <span>🏛 ${escapeHtml(p.college)} ${p.crossCollege ? "• 🌐 Cross-College" : ""}</span>
            <span class="font-semibold text-charcoal">${p.members.length}/${p.teamSize} Joined</span>
          </div>
          <div class="text-[11px] text-muted"><strong class="text-charcoal">Needed:</strong> ${p.neededRoles.map((r) => escapeHtml(r)).join(", ")}</div>
          <button type="button" onclick="openProjectModal('${p.id}')" class="w-full py-2.5 rounded-xl bg-charcoal hover:bg-neutral-800 text-white text-xs font-semibold transition-colors">View Details & Apply →</button>
        </div>
      </div>`;
    })
    .join("");
}

async function toggleSaveProject(id) {
  try {
    const saved = state.savedIds.includes(id);
    await API.setSaved(state.user.id, id, !saved);
    state.savedIds = saved ? state.savedIds.filter((x) => x !== id) : state.savedIds.concat(id);
    showToast(saved ? "Removed from saved opportunities" : "Saved to your opportunities");
    renderMarketplace();
  } catch (err) {
    toastError(err);
  }
}

function matchReason(s) {
  const userSkills = (state.user?.skills || []).map((x) => x.toLowerCase());
  const common = (s.skills || []).filter((sk) => userSkills.includes(sk.toLowerCase()));
  if (common.length) return `You both know ${common.slice(0, 2).join(" and ")}`;
  const userInterests = (state.user?.interests || []).map((x) => x.toLowerCase());
  const sharedInterest = (s.interests || []).find((i) => userInterests.includes(i.toLowerCase()));
  if (sharedInterest) return `Shared interest in ${sharedInterest}`;
  if (s.college && state.user?.college && s.college.toLowerCase() === state.user.college.toLowerCase()) {
    return "Same campus";
  }
  if (s.role && state.user?.role) return `${s.role} + ${state.user.role} — complementary roles`;
  return "Strong skill overlap for your projects";
}

function renderTeammates() {
  const preview = document.getElementById("matchSkillsPreview");
  if (preview && state.user) preview.textContent = (state.user.skills || []).slice(0, 4).join(", ");

  const q = ((document.getElementById("teammateSearch") || {}).value || "").toLowerCase();
  const role = (document.getElementById("teammateRole") || {}).value || "All";
  const avail = (document.getElementById("teammateAvailability") || {}).value || "All";

  const statsEl = document.getElementById("teammateStats");
  if (statsEl) {
    const builders = state.students.length + (state.user ? 1 : 0);
    const colleges = new Set();
    if (state.user?.college) colleges.add(state.user.college.toLowerCase());
    state.students.forEach((s) => {
      if (s.college) colleges.add(s.college.toLowerCase());
    });
    const skillCounts = {};
    const allSkills = [...(state.user?.skills || []), ...state.students.flatMap((s) => s.skills || [])];
    allSkills.forEach((sk) => {
      const k = sk.toLowerCase();
      skillCounts[k] = (skillCounts[k] || 0) + 1;
    });
    const topSkills = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
    statsEl.innerHTML = `
      <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-2xl font-black text-charcoal">${builders}</div><div class="text-xs text-muted">Builders</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-2xl font-black text-charcoal">${colleges.size}</div><div class="text-xs text-muted">Colleges</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-sm font-black text-limeu-dark leading-tight">${topSkills.length ? topSkills.join(", ") : "—"}</div><div class="text-xs text-muted mt-1">In-demand skills</div></div>`;
  }

  const list = state.students
    .filter((s) => !state.blockedIds.includes(s.id))
    .map((s) => Object.assign({}, s, { match: computeMatchScore(s.skills) }))
    .filter((s) => {
      if (role !== "All" && s.role !== role) return false;
      if (avail !== "All" && s.availability !== avail) return false;
      if (q) {
        const hay = [s.name, s.college, s.dept, s.role, ...s.skills, ...s.interests].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.match - a.match);

  const grid = document.getElementById("teammatesGrid");
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML =
      '<div class="col-span-full bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-muted">No matching teammates yet. Invite friends to sign up and build your network.</div>';
    return;
  }

  grid.innerHTML = list
    .map((s) => {
      const avatar = s.avatarUrl
        ? `<img src="${s.avatarUrl}" alt="${escapeHtml(s.name)}" class="w-11 h-11 rounded-full object-cover shrink-0" />`
        : `<div class="w-11 h-11 rounded-full bg-charcoal text-limeu font-extrabold text-sm flex items-center justify-center shrink-0">${escapeHtml(s.initials)}</div>`;

      return `
      <div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm hover:border-limeu transition-all flex flex-col justify-between gap-4">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              ${avatar}
              <div>
                <div class="font-bold text-base text-charcoal flex items-center gap-1.5">
                  <span>${escapeHtml(s.name)}</span>
                  ${s.verified ? '<span class="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] inline-flex items-center justify-center">✓</span>' : ""}
                </div>
                <div class="text-xs text-muted">${escapeHtml(s.college)}${s.sem ? " • " + escapeHtml(s.sem) : ""}</div>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full bg-limeu-soft text-limeu-dark text-[11px] font-extrabold shrink-0">${s.match}% Match</span>
          </div>
          <div class="inline-block px-2.5 py-0.5 rounded-full bg-canvas border border-gray-200 text-[11px] font-semibold text-charcoal">${escapeHtml(s.role)} • ${escapeHtml(s.availability)}</div>
          <div class="text-[11px] font-semibold text-limeu-dark">Why you match: ${escapeHtml(matchReason(s))}</div>
          <p class="text-xs text-muted leading-relaxed">${escapeHtml(s.bio)}</p>
          <div class="flex flex-wrap gap-1.5">
            ${s.skills.map((sk) => `<span class="px-2 py-0.5 rounded-md bg-canvas text-[11px] font-medium text-charcoal">${escapeHtml(sk)}</span>`).join("")}
          </div>
        </div>
        <div class="pt-3 border-t border-gray-100 flex items-center gap-2">
          <button type="button" onclick="openStudentModal('${s.id}')" class="flex-1 py-2 rounded-xl bg-charcoal hover:bg-neutral-800 text-white text-xs font-semibold">Profile & Invite</button>
          <button type="button" onclick="connectStudent('${s.id}')" class="px-3.5 py-2 rounded-xl bg-canvas hover:bg-gray-200 text-charcoal text-xs font-semibold border border-gray-200">Connect</button>
        </div>
      </div>`;
    })
    .join("");
}

async function connectStudent(id) {
  const student = state.students.find((s) => s.id === id);
  try {
    await API.connect(state.user.id, id);
    showToast("Connection request sent to " + (student ? student.name : "student"));
    scheduleRefresh();
  } catch (err) {
    toastError(err);
  }
}

function renderConnections() {
  const list = document.getElementById("connList");
  const count = document.getElementById("connCount");
  if (!list) return;

  const conns = state.connections || [];
  const pending = conns.filter((c) => c.status === "pending" && c.direction === "incoming");
  const outgoing = conns.filter((c) => c.status === "pending" && c.direction === "outgoing");
  const accepted = conns.filter((c) => c.status === "accepted");

  if (count) count.textContent = pending.length ? pending.length + " pending" : "";

  if (!conns.length) {
    list.innerHTML = '<div class="text-xs text-muted py-4 text-center">No connection requests yet.</div>';
    return;
  }

  const item = (c) => {
    let actions;
    if (c.direction === "incoming" && c.status === "pending") {
      actions = `<div class="flex gap-1.5 shrink-0">
        <button type="button" onclick="acceptConnection('${c.id}')" class="px-2.5 py-1 rounded-lg bg-charcoal text-white text-[11px] font-semibold">Accept</button>
        <button type="button" onclick="declineConnection('${c.id}')" class="px-2.5 py-1 rounded-lg bg-white border border-gray-300 text-[11px] font-semibold">Decline</button>
      </div>`;
    } else if (c.status === "pending") {
      actions = '<span class="text-[11px] font-semibold text-amber-700 shrink-0">Pending</span>';
    } else if (c.status === "accepted") {
      actions = '<span class="text-[11px] font-semibold text-emerald-700 shrink-0">Connected</span>';
    } else {
      actions = '<span class="text-[11px] font-semibold text-muted shrink-0">Declined</span>';
    }

    return `<div class="p-3 rounded-xl bg-canvas border border-gray-200 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-8 h-8 rounded-full bg-charcoal text-limeu font-bold text-[11px] flex items-center justify-center shrink-0">${escapeHtml(c.initials)}</div>
        <div class="min-w-0">
          <div class="text-xs font-bold text-charcoal truncate">${escapeHtml(c.name)}</div>
          <div class="text-[11px] text-muted truncate">${escapeHtml(c.college || "")}${c.direction === "incoming" ? " • incoming" : " • outgoing"}</div>
        </div>
      </div>
      ${actions}
    </div>`;
  };

  const ordered = pending.concat(outgoing, accepted);
  list.innerHTML = ordered.map(item).join("");
}

async function acceptConnection(connId) {
  try {
    const conn = state.connections.find((c) => c.id === connId);
    await API.updateConnection(connId, "accepted");
    if (conn) await API.notifyUser(conn.userId, "accepted your connection request.");
    await refreshAll();
    showToast("Connection accepted");
  } catch (err) {
    toastError(err);
  }
}

async function declineConnection(connId) {
  try {
    const conn = state.connections.find((c) => c.id === connId);
    await API.updateConnection(connId, "rejected");
    if (conn) await API.notifyUser(conn.userId, "declined your connection request.");
    await refreshAll();
    showToast("Connection declined");
  } catch (err) {
    toastError(err);
  }
}

async function enablePushNotifications() {
  if (!window.Push) {
    showToast("Push notifications are not supported in this browser.");
    return;
  }
  try {
    const enabled = await window.Push.enable();
    showToast(enabled ? "Push notifications enabled" : "Push notifications were not enabled");
  } catch (err) {
    toastError(err);
  }
}

function renderWorkspaces() {
  const mine = myProjects();
  const listEl = document.getElementById("workspaceList");
  const body = document.getElementById("workspaceBody");
  if (!listEl || !body) return;

  if (!mine.length) {
    listEl.innerHTML = '<div class="text-xs text-muted p-2">No workspaces yet. Post or join a project!</div>';
    body.innerHTML =
      '<div class="text-center text-sm text-muted py-10">You have not joined or created a project yet. Explore ideas and send a collaboration request to unlock workspaces.</div>';
    return;
  }

  const active = mine.find((p) => p.id === state.activeWorkspaceId) || mine[0];
  state.activeWorkspaceId = active.id;

  const sameProject = state._renderedWsId === active.id;
  const prev = sameProject
    ? {
        chat: (document.getElementById("wsChatInput") || {}).value || "",
        task: (document.getElementById("wsTaskTitle") || {}).value || "",
        resTitle: (document.getElementById("wsResTitle") || {}).value || "",
        resUrl: (document.getElementById("wsResUrl") || {}).value || ""
      }
    : { chat: "", task: "", resTitle: "", resUrl: "" };
  state._renderedWsId = active.id;

  listEl.innerHTML = mine
    .map(
      (p) => `
      <button type="button" onclick="selectWorkspace('${p.id}')" class="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between ${p.id === active.id ? "bg-charcoal text-white" : "hover:bg-canvas text-charcoal"}">
        <span class="truncate">${escapeHtml(p.title)}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded ${p.id === active.id ? "bg-limeu text-charcoal" : "bg-gray-200 text-charcoal"}">${p.members.length}</span>
      </button>`
    )
    .join("");

  const doneCount = active.tasks.filter((t) => t.status === "Done").length;
  const totalTasks = active.tasks.length;
  const pct = totalTasks ? Math.round((doneCount / totalTasks) * 100) : 0;

  const header = document.getElementById("workspaceHeader");
  if (header) {
    header.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-extrabold text-charcoal">${escapeHtml(active.title)}</h2>
          <span class="px-2.5 py-0.5 rounded-full bg-limeu-soft text-limeu-dark text-[11px] font-bold">${escapeHtml(active.category)}</span>
          ${active.completed ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">Showcased ✓</span>' : ""}
        </div>
        <p class="text-xs text-muted mt-0.5">${escapeHtml(active.tagline)} • ${active.members.length} members</p>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right">
          <div class="text-[11px] font-bold text-charcoal">Progress: ${pct}%</div>
          <div class="w-28 h-2 rounded-full bg-gray-200 overflow-hidden mt-1">
            <div class="h-full bg-limeu" style="width:${pct}%"></div>
          </div>
        </div>
      </div>`;
  }

  document.querySelectorAll(".ws-tab-btn").forEach((b) => {
    const isAct = b.dataset.wstab === state.activeWorkspaceTab;
    b.classList.toggle("border-charcoal", isAct);
    b.classList.toggle("text-charcoal", isAct);
    b.classList.toggle("text-muted", !isAct);
  });

  if (state.activeWorkspaceTab === "chat") {
    const msgs = active.messages || [];
    body.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-[11px] font-bold text-muted uppercase tracking-wider">Team Chat</div>
        <button type="button" onclick="aiSummarizeChat('${active.id}')" class="text-[11px] font-bold text-limeu-dark">AI Summary</button>
      </div>
      <div class="space-y-3 max-h-80 overflow-y-auto mb-4 pr-1">
        ${msgs.length ? msgs.map((m) => `
          <div class="p-3 rounded-xl ${m.senderId === state.user.id ? "bg-limeu-soft/70 ml-8" : "bg-canvas mr-8"}">
            <div class="flex items-center justify-between text-[11px] mb-1">
              <span class="font-bold text-charcoal">${escapeHtml(m.sender)}</span>
              <span class="text-muted">${escapeHtml(m.time)}</span>
            </div>
            <div class="text-xs sm:text-sm text-charcoal">${escapeHtml(m.text)}</div>
          </div>`).join("") : '<div class="text-xs text-muted py-6 text-center">Start the team conversation!</div>'}
      </div>
      <form onsubmit="sendWorkspaceMessage(event, '${active.id}')" class="flex gap-2">
        <input id="wsChatInput" type="text" required placeholder="Message teammates or paste a link..." class="flex-1 px-4 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm focus:outline-none focus:border-charcoal" />
        <button type="submit" class="px-5 py-2.5 rounded-xl bg-charcoal text-white text-xs sm:text-sm font-semibold hover:bg-neutral-800">Send</button>
      </form>`;
  } else if (state.activeWorkspaceTab === "tasks") {
    const tasks = active.tasks || [];
    body.innerHTML = `
      <form onsubmit="addWorkspaceTask(event, '${active.id}')" class="flex flex-col sm:flex-row gap-2 mb-5">
        <input id="wsTaskTitle" type="text" required placeholder="New milestone or task..." class="flex-1 px-3.5 py-2 rounded-xl bg-canvas border border-gray-200 text-sm" />
        <select id="wsTaskAssignee" class="px-3 py-2 rounded-xl bg-canvas border border-gray-200 text-xs font-medium">
          ${active.memberIds.map((id, i) => `<option value="${id}">${escapeHtml(active.members[i] || "Member")}</option>`).join("")}
        </select>
        <button type="submit" class="px-4 py-2 rounded-xl bg-charcoal text-white text-xs font-semibold">+ Add Task</button>
      </form>
      <div class="space-y-2">
        ${tasks.length ? tasks.map((t) => `
          <div class="flex items-center justify-between p-3 rounded-xl bg-canvas border border-gray-200/80 gap-3">
            <div>
              <div class="text-sm font-semibold text-charcoal ${t.status === "Done" ? "line-through opacity-60" : ""}">${escapeHtml(t.title)}</div>
              <div class="text-[11px] text-muted">Assigned to ${escapeHtml(t.assignee)}</div>
            </div>
            <button type="button" onclick="cycleTaskStatus('${active.id}', '${t.id}')" class="px-3 py-1 rounded-full text-[11px] font-bold ${t.status === "Done" ? "bg-emerald-100 text-emerald-800" : t.status === "In Progress" ? "bg-limeu-soft text-limeu-dark" : "bg-gray-200 text-charcoal"}">${escapeHtml(t.status)}</button>
          </div>`).join("") : '<div class="text-xs text-muted py-6 text-center">No tasks yet. Add your first milestone above.</div>'}
      </div>`;
  } else if (state.activeWorkspaceTab === "resources") {
    const res = active.resources || [];
    body.innerHTML = `
      <form onsubmit="addWorkspaceResource(event, '${active.id}')" class="flex flex-col sm:flex-row gap-2 mb-5">
        <input id="wsResTitle" type="text" required placeholder="Resource label (e.g. GitHub Repo)" class="flex-1 px-3.5 py-2 rounded-xl bg-canvas border border-gray-200 text-sm" />
        <input id="wsResUrl" type="url" required placeholder="https://..." class="flex-1 px-3.5 py-2 rounded-xl bg-canvas border border-gray-200 text-sm" />
        <button type="submit" class="px-4 py-2 rounded-xl bg-charcoal text-white text-xs font-semibold">+ Add Link</button>
      </form>
      <div class="grid sm:grid-cols-2 gap-3">
        ${res.length ? res.map((r) => `
          <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="p-3.5 rounded-xl bg-canvas border border-gray-200 hover:border-limeu flex items-center justify-between">
            <span class="text-sm font-semibold text-charcoal truncate">${escapeHtml(r.title)}</span>
            <span class="text-xs font-bold text-limeu-dark">↗</span>
          </a>`).join("") : '<div class="col-span-full text-xs text-muted py-4 text-center">No shared resources yet.</div>'}
      </div>`;
  } else if (state.activeWorkspaceTab === "team") {
    const reqs = active.pendingRequests || [];
    body.innerHTML = `
      <div class="space-y-6">
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-muted mb-2.5">Active Team Members (${active.members.length}/${active.teamSize})</h3>
          <div class="flex flex-wrap gap-2">
            ${active.members.map((m) => `<span class="px-3.5 py-1.5 rounded-full bg-canvas border border-gray-200 text-xs font-semibold text-charcoal">👤 ${escapeHtml(m)}</span>`).join("")}
          </div>
        </div>
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-muted mb-2.5">Pending Join Requests (${reqs.length})</h3>
          <div class="space-y-2.5">
            ${reqs.length ? reqs.map((r) => `
              <div class="p-3.5 rounded-xl bg-canvas border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div class="font-bold text-sm text-charcoal">${escapeHtml(r.name)} <span class="text-xs font-normal text-muted">• ${escapeHtml(r.college)}</span></div>
                  <div class="text-xs text-limeu-dark font-semibold">Role: ${escapeHtml(r.role)}</div>
                  <div class="text-xs text-muted mt-0.5">"${escapeHtml(r.pitch)}"</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button type="button" onclick="handleJoinRequest('${active.id}', '${r.id}', true)" class="px-3.5 py-1.5 rounded-lg bg-charcoal text-white text-xs font-semibold hover:bg-neutral-800">Approve</button>
                  <button type="button" onclick="handleJoinRequest('${active.id}', '${r.id}', false)" class="px-3.5 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-semibold">Decline</button>
                </div>
              </div>`).join("") : '<div class="text-xs text-muted">No pending requests right now.</div>'}
          </div>
        </div>
        <div class="pt-4 border-t border-gray-100 flex items-center justify-between">
          <div>
            <div class="font-bold text-sm text-charcoal">Public Portfolio Showcase</div>
            <div class="text-xs text-muted">Mark project completed to feature it in the public showcase.</div>
          </div>
          <button type="button" onclick="toggleShowcase('${active.id}')" class="px-4 py-2 rounded-full text-xs font-bold ${active.completed ? "bg-emerald-100 text-emerald-800" : "bg-limeu text-charcoal"}">
            ${active.completed ? "✓ Showcased Publicly" : "Publish to Showcase"}
          </button>
        </div>
      </div>`;
  }

  if (prev.chat) {
    const c = document.getElementById("wsChatInput");
    if (c) c.value = prev.chat;
  }
  if (prev.task) {
    const t = document.getElementById("wsTaskTitle");
    if (t) t.value = prev.task;
  }
  if (prev.resTitle) {
    const t = document.getElementById("wsResTitle");
    if (t) t.value = prev.resTitle;
  }
  if (prev.resUrl) {
    const u = document.getElementById("wsResUrl");
    if (u) u.value = prev.resUrl;
  }
}

function selectWorkspace(id) {
  state.activeWorkspaceId = id;
  renderWorkspaces();
}

function switchWorkspaceTab(tab) {
  state.activeWorkspaceTab = tab;
  renderWorkspaces();
}

async function sendWorkspaceMessage(e, projId) {
  e.preventDefault();
  const input = document.getElementById("wsChatInput");
  const text = input ? input.value.trim() : "";
  if (!text) return;
  const project = state.projects.find((x) => x.id === projId);
  if (!project) return;

  input.value = "";
  const tempId = "temp-" + Date.now();
  project.messages = project.messages || [];
  project.messages.push({ id: tempId, sender: state.user.name, senderId: state.user.id, text, time: "Just now" });
  renderWorkspaces();

  try {
    const row = await API.sendMessage(projId, state.user.id, text);
    const idx = project.messages.findIndex((m) => m.id === tempId);
    if (idx >= 0) {
      project.messages[idx] = {
        id: row.id,
        sender: state.user.name,
        senderId: row.sender_id,
        text: row.text,
        time: API.formatTime(row.created_at)
      };
    }
    renderWorkspaces();
  } catch (err) {
    project.messages = project.messages.filter((m) => m.id !== tempId);
    if (input) input.value = text;
    renderWorkspaces();
    toastError(err);
  }
}

async function addWorkspaceTask(e, projId) {
  e.preventDefault();
  const title = (document.getElementById("wsTaskTitle") || {}).value || "";
  const assigneeId = (document.getElementById("wsTaskAssignee") || {}).value || null;
  const project = state.projects.find((x) => x.id === projId);
  if (!project || !title.trim()) return;

  try {
    await API.createTask(projId, title.trim(), assigneeId);
    const assigneeName =
      state.students.find((s) => s.id === assigneeId)?.name ||
      (state.user.id === assigneeId ? state.user.name : "Unassigned");
    project.tasks = project.tasks || [];
    project.tasks.push({ id: "temp-" + Date.now(), title: title.trim(), assignee: assigneeName, assigneeId, status: "To Do" });
    renderWorkspaces();
    scheduleRefresh();
  } catch (err) {
    toastError(err);
  }
}

async function cycleTaskStatus(projId, taskId) {
  const project = state.projects.find((x) => x.id === projId);
  const task = (project?.tasks || []).find((x) => x.id === taskId);
  if (!task) return;
  const order = ["To Do", "In Progress", "Done"];
  const next = order[(order.indexOf(task.status) + 1) % order.length];
  task.status = next;
  renderWorkspaces();
  try {
    await API.updateTaskStatus(taskId, next);
  } catch (err) {
    toastError(err);
  }
}

async function addWorkspaceResource(e, projId) {
  e.preventDefault();
  const title = ((document.getElementById("wsResTitle") || {}).value || "").trim();
  const url = ((document.getElementById("wsResUrl") || {}).value || "").trim();
  const project = state.projects.find((x) => x.id === projId);
  if (!project || !title || !url) return;

  try {
    await API.createResource(projId, title, url, state.user.id);
    project.resources = project.resources || [];
    project.resources.push({ id: "temp-" + Date.now(), title, url });
    renderWorkspaces();
    scheduleRefresh();
  } catch (err) {
    toastError(err);
  }
}

async function handleJoinRequest(projId, reqId, approve) {
  const project = state.projects.find((x) => x.id === projId);
  const req = project ? (project.pendingRequests || []).find((r) => r.id === reqId) : null;

  if (project) {
    project.pendingRequests = (project.pendingRequests || []).filter((r) => r.id !== reqId);
    if (approve && req) {
      if (!project.memberIds.includes(req.applicantId)) {
        project.memberIds = project.memberIds.concat(req.applicantId);
        project.members = project.members.concat(req.name);
      }
      project.messages = project.messages || [];
      project.messages.push({
        id: "temp-" + Date.now(),
        sender: state.user.name,
        senderId: state.user.id,
        text: req.role + " request accepted — welcome to the team!",
        time: "Just now"
      });
    }
  }
  renderWorkspaces();

  try {
    await API.reviewApplication(reqId, approve ? "Accepted" : "Rejected", state.user.id);
    showToast(approve ? "Applicant added to the team!" : "Request declined");
    await refreshAll();
  } catch (err) {
    toastError(err);
    await refreshAll();
  }
}

async function toggleShowcase(projId) {
  const project = state.projects.find((x) => x.id === projId);
  if (!project) return;
  const next = !project.completed;
  project.completed = next;
  renderWorkspaces();
  try {
    await API.updateProject(projId, { completed: next });
    showToast(next ? "Published to Public Showcase!" : "Removed from Showcase");
  } catch (err) {
    project.completed = !next;
    renderWorkspaces();
    toastError(err);
  }
}

function switchHackathonTab(tab) {
  state.activeHackathonTab = tab;
  renderHackathons();
}

const COMING_SOON = [
  { icon: "🤖", title: "AI Build Weekend", desc: "A cross-campus sprint for AI agents, RAG apps, and open-source models." },
  { icon: "🎨", title: "Design for Good", desc: "A UI/UX sprint with real NGO and campus-club briefs." },
  { icon: "🌐", title: "Open Source Sprint", desc: "Ship your first merged PR with maintainers from real projects." },
  { icon: "🚀", title: "Founder's Garage", desc: "Pitch and MVP a startup in 48 hours with cross-functional teams." }
];

function comingSoonBoard() {
  return `
    <div class="mt-8">
      <div class="flex items-center gap-3 mb-4">
        <span class="text-xs font-bold uppercase tracking-widest text-muted">Coming Soon</span>
        <span class="h-px flex-1 bg-gray-200"></span>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${COMING_SOON.map(
          (c) => `
          <div class="bg-white rounded-2xl border border-dashed border-gray-300 p-5 flex flex-col gap-2">
            <div class="text-2xl">${c.icon}</div>
            <div class="font-extrabold text-sm text-charcoal">${escapeHtml(c.title)}</div>
            <p class="text-xs text-muted leading-relaxed">${escapeHtml(c.desc)}</p>
            <span class="mt-auto text-[10px] font-bold uppercase tracking-wider text-limeu-dark">Coming Soon</span>
          </div>`
        ).join("")}
      </div>
    </div>`;
}

function renderHackathons() {
  document.querySelectorAll(".htab-btn").forEach((b) => {
    b.classList.toggle("tab-pill-active", b.dataset.htab === state.activeHackathonTab);
  });

  const container = document.getElementById("hackathonsContent");
  if (!container) return;

  if (state.activeHackathonTab === "events") {
    container.innerHTML = `<div class="grid md:grid-cols-3 gap-6">${state.events.length ? state.events.map((ev) => `
      <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm flex flex-col justify-between gap-4">
        <div class="space-y-2.5">
          <div class="flex items-center justify-between text-xs">
            <span class="px-2.5 py-0.5 rounded-full bg-limeu-soft text-limeu-dark font-bold">${escapeHtml(ev.tag)}</span>
            <span class="text-muted font-medium">${escapeHtml(ev.mode)}</span>
          </div>
          <div class="flex items-center gap-2">
            <h3 class="font-extrabold text-lg text-charcoal">${escapeHtml(ev.title)}</h3>
            ${ev.completed ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">✓ Completed</span>' : ""}
          </div>
          <div class="text-xs font-semibold text-charcoal">📅 ${escapeHtml(ev.date)} • ${escapeHtml(ev.organizer)}</div>
          <p class="text-xs text-muted leading-relaxed">${escapeHtml(ev.desc)}</p>
        </div>
        <div class="flex gap-2 pt-3 border-t border-gray-100">
          <button type="button" onclick="toggleEventRSVP('${ev.id}')" class="flex-1 py-2 rounded-xl text-xs font-semibold ${ev.registered ? "bg-emerald-100 text-emerald-800" : "bg-charcoal text-white hover:bg-neutral-800"}">
            ${ev.registered ? "✓ Registered" : "RSVP / Register"}
          </button>
          <button type="button" onclick="navigateTo('teammates')" class="px-3 py-2 rounded-xl bg-canvas border border-gray-200 text-xs font-semibold hover:bg-gray-200">Find Team</button>
        </div>
        ${ev.organizerId === state.user.id ? `<div class="flex gap-2 pt-3 border-t border-gray-100">
          <button type="button" onclick="toggleEventCompleted('${ev.id}')" class="flex-1 py-2 rounded-xl text-xs font-semibold ${ev.completed ? "bg-emerald-100 text-emerald-800" : "bg-canvas border border-gray-200"}">${ev.completed ? "✓ Completed" : "Mark Completed"}</button>
          <button type="button" onclick="deleteEvent('${ev.id}')" class="px-3 py-2 rounded-xl bg-white border border-red-200 text-red-600 text-xs font-semibold">Delete</button>
        </div>` : ""}
      </div>`).join("") : '<div class="col-span-full bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-muted">No events yet. Organize the first hackathon or workshop.</div>'}</div>${comingSoonBoard()}`;
  } else if (state.activeHackathonTab === "communities") {
    container.innerHTML = `<div class="grid sm:grid-cols-2 gap-5">${state.communities.length ? state.communities.map((c) => `
      <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm flex items-center justify-between gap-4">
        <div>
          <h3 class="font-extrabold text-base text-charcoal">${escapeHtml(c.name)}</h3>
          <p class="text-xs text-muted mt-1">${escapeHtml(c.focus)}</p>
          <div class="text-xs font-bold text-limeu-dark mt-2">👥 ${escapeHtml(c.members)}</div>
        </div>
        <button type="button" onclick="toggleCommunity('${c.id}', ${c.joined ? "false" : "true"})" class="px-4 py-2 rounded-full text-xs font-semibold shrink-0 ${c.joined ? "bg-emerald-100 text-emerald-800" : "bg-charcoal text-white hover:bg-neutral-800"}">
          ${c.joined ? "✓ Joined" : "Join Space"}
        </button>
      </div>`).join("") : '<div class="col-span-full bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-muted">No communities yet.</div>'}</div>`;
  } else {
    const completed = state.projects.filter((p) => p.completed);
    container.innerHTML = `<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">${completed.length ? completed.map((p) => `
      <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-3">
        <span class="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">✓ Completed Build</span>
        <h3 class="font-extrabold text-lg text-charcoal">${escapeHtml(p.title)}</h3>
        <p class="text-xs text-muted">${escapeHtml(p.description)}</p>
        <div class="text-xs font-semibold text-charcoal">Team: ${p.members.map((m) => escapeHtml(m)).join(", ")}</div>
        <button type="button" onclick="openProjectModal('${p.id}')" class="text-xs font-bold text-limeu-dark hover:underline">View Portfolio Details →</button>
      </div>`).join("") : '<div class="col-span-full bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-muted">No completed projects showcased yet.</div>'}</div>`;
  }
}

async function toggleEventRSVP(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const next = !ev.registered;
  ev.registered = next;
  renderHackathons();
  try {
    await API.setRsvp(id, state.user.id, next);
    showToast(next ? "Registered for " + ev.title + "!" : "Registration cancelled");
  } catch (err) {
    ev.registered = !next;
    renderHackathons();
    toastError(err);
  }
}

async function toggleEventCompleted(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const next = !ev.completed;
  ev.completed = next;
  ev.completedAt = next ? new Date().toISOString() : null;
  renderHackathons();
  try {
    await API.setEventCompleted(id, next);
    showToast(next ? "Event marked completed" : "Event reopened");
  } catch (err) {
    ev.completed = !next;
    renderHackathons();
    toastError(err);
  }
}

async function deleteEvent(id) {
  if (!confirm("Delete this event? This cannot be undone.")) return;
  try {
    await API.deleteEvent(id);
    await refreshAll();
    showToast("Event deleted");
  } catch (err) {
    toastError(err);
  }
}

async function deleteProject(projId) {
  if (!confirm("Delete this project? This cannot be undone.")) return;
  try {
    await API.deleteProject(projId);
    closeModal();
    await refreshAll();
    showToast("Project deleted");
  } catch (err) {
    toastError(err);
  }
}

function openReportModal(targetType, targetId, targetName) {
  openModal(`
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-black text-charcoal">Report ${escapeHtml(targetName || targetType)}</h2>
      <button type="button" onclick="closeModal()" class="p-1.5 rounded-full hover:bg-canvas text-muted">✕</button>
    </div>
    <form onsubmit="submitReport(event, '${targetType}', '${targetId}')" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs font-bold text-muted uppercase mb-1">Reason</label>
        <select id="reportReason" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200">
          <option>Spam or misleading</option>
          <option>Harassment or hate</option>
          <option>Inappropriate content</option>
          <option>Impersonation</option>
          <option>Other</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-muted uppercase mb-1">Details (optional)</label>
        <textarea id="reportDetails" rows="2" placeholder="Add any context..." class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200"></textarea>
      </div>
      <button type="submit" class="w-full py-2.5 rounded-xl bg-charcoal text-white text-xs font-bold">Submit Report →</button>
    </form>
  `);
}

async function submitReport(e, targetType, targetId) {
  e.preventDefault();
  const reason = (document.getElementById("reportReason") || {}).value || "Other";
  const details = (document.getElementById("reportDetails") || {}).value.trim();
  try {
    await API.createReport({ reporterId: state.user.id, targetType, targetId, reason, details });
    closeModal();
    showToast("Report submitted. Thank you.");
  } catch (err) {
    toastError(err);
  }
}

async function unblockUser(id) {
  try {
    await API.unblockUser(state.user.id, id);
    state.blockedIds = state.blockedIds.filter((x) => x !== id);
    state.blockedUsers = (state.blockedUsers || []).filter((u) => u.id !== id);
    renderDashboard();
    showToast("User unblocked");
  } catch (err) {
    toastError(err);
  }
}

async function toggleCommunity(id, joined) {
  try {
    await API.setCommunityMembership(id, state.user.id, joined);
    const c = state.communities.find((x) => x.id === id);
    if (c) c.joined = joined;
    renderHackathons();
    showToast(joined ? "Joined the community!" : "Left the community");
  } catch (err) {
    toastError(err);
  }
}

/* ------------------------------------------------------- streak challenge */

async function loadChallenge() {
  if (state.challenge.loading) return;
  state.challenge.loading = true;
  state.challenge.loaded = false;
  renderChallenges();

  try {
    const userId = state.user.id;
    const connection = await API.getGithubConnection(userId);
    let data = { team: null, members: [], days: [], events: [] };
    if (connection) {
      data = await API.getChallengeData(userId);
    }
    state.challenge = {
      loading: false,
      loaded: true,
      connection,
      team: data.team,
      members: data.members || [],
      days: data.days || [],
      events: data.events || []
    };
  } catch (err) {
    console.error("[CollabU] challenge load failed", err);
    state.challenge = {
      loading: false,
      loaded: true,
      connection: null,
      team: null,
      members: [],
      days: [],
      events: [],
      error: err
    };
  }

  renderChallenges();
}

function renderChallenges() {
  const container = document.getElementById("challengeContent");
  if (!container) return;

  const c = state.challenge;

  if (!c.loaded && !c.loading) {
    loadChallenge();
    return;
  }
  if (c.loading && !c.loaded) {
    container.innerHTML =
      '<div class="text-center text-sm text-muted py-12">Loading streak challenge…</div>';
    return;
  }

  if (!c.connection) {
    container.innerHTML = `
      <div class="max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-sm">
        <div class="text-4xl mb-3">🔥</div>
        <h1 class="text-2xl font-black text-charcoal">Team Streak Challenge</h1>
        <p class="text-sm text-muted mt-2 leading-relaxed">
          Connect your GitHub account to create or join a team. Keep at least 60% of the team pushing every UTC day to grow your streak. You get 3 Streak Saves to survive missed days.
        </p>
        <button type="button" onclick="connectGitHub()" class="mt-5 px-6 py-3 rounded-full bg-charcoal hover:bg-neutral-800 text-white text-sm font-bold">Connect GitHub →</button>
        <p class="text-[11px] text-muted mt-3">We request read access to your contributions and repo metadata. Tokens stay server-side.</p>
        <details class="mt-4 text-left">
          <summary class="text-xs font-semibold text-muted cursor-pointer">Use a Personal Access Token instead</summary>
          <form onsubmit="connectWithToken(event)" class="mt-2 space-y-2">
            <input id="ghToken" type="password" required placeholder="github_pat_..." class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm" />
            <button type="submit" class="w-full py-2 rounded-xl border border-charcoal text-charcoal text-xs font-bold">Connect with Token</button>
            <p class="text-[11px] text-muted">Create a token with read:user and repo scopes at https://github.com/settings/tokens</p>
          </form>
        </details>
      </div>`;
    return;
  }

  if (!c.team) {
    container.innerHTML = `
      <div class="max-w-4xl mx-auto space-y-5">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-charcoal text-limeu font-black text-xs flex items-center justify-center">${escapeHtml(API.initialsOf(c.connection.github_login))}</div>
          <div>
            <div class="text-sm font-bold text-charcoal">Connected as @${escapeHtml(c.connection.github_login)}</div>
            <div class="text-[11px] text-muted">GitHub streak challenge</div>
          </div>
        </div>

        <div class="grid md:grid-cols-2 gap-5">
          <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 class="font-bold text-lg text-charcoal">Create a Team</h2>
            <p class="text-xs text-muted mt-1 mb-4">Pick a shared repo and invite teammates with the code.</p>
            <form onsubmit="createChallengeTeam(event)" class="space-y-3">
              <div>
                <label class="block text-xs font-bold text-muted uppercase mb-1">Team name</label>
                <input id="challengeName" type="text" required placeholder="e.g. Midnight Builders" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm" />
              </div>
              <div>
                <label class="block text-xs font-bold text-muted uppercase mb-1">Shared GitHub repo</label>
                <input id="challengeRepo" type="text" required placeholder="owner/repo" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm" />
              </div>
              <button type="submit" class="w-full py-2.5 rounded-xl bg-charcoal text-white text-xs font-bold">Create Team →</button>
            </form>
          </div>

          <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 class="font-bold text-lg text-charcoal">Join with Code</h2>
            <p class="text-xs text-muted mt-1 mb-4">Ask a teammate for their 8-character invite code.</p>
            <form onsubmit="joinChallengeTeam(event)" class="space-y-3">
              <div>
                <label class="block text-xs font-bold text-muted uppercase mb-1">Invite code</label>
                <input id="challengeCode" type="text" required placeholder="ABCD1234" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm font-mono uppercase tracking-widest" />
              </div>
              <button type="submit" class="w-full py-2.5 rounded-xl border border-charcoal text-charcoal text-xs font-bold">Join Challenge →</button>
            </form>
          </div>
        </div>
      </div>`;
    return;
  }

  const team = c.team;
  const members = c.members || [];
  const pushedToday = members.filter((m) => m.pushed).length;
  const quorum = Math.max(1, Math.ceil(members.length * 0.6));

  container.innerHTML = `
    <div class="space-y-5">
      <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-2xl font-black text-charcoal">${escapeHtml(team.name)}</h1>
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${team.status === "active" ? "bg-limeu-soft text-limeu-dark" : "bg-red-100 text-red-700"}">${team.status === "active" ? "Active" : "Ended"}</span>
            </div>
            <p class="text-xs text-muted mt-1">GitHub: ${escapeHtml(team.repo_full_name)}</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="px-3 py-2 rounded-xl bg-canvas border border-gray-200">
              <div class="text-[10px] uppercase font-bold text-muted">Invite code</div>
              <div class="font-mono font-black text-charcoal tracking-widest">${escapeHtml(team.invite_code)}</div>
            </div>
            <button type="button" onclick="copyInviteCode('${team.invite_code}')" class="px-3 py-2 rounded-xl bg-charcoal text-white text-xs font-semibold">Copy</button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-2xl font-black text-charcoal">${team.streak_days}</div><div class="text-xs text-muted">Current Streak</div></div>
        <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-2xl font-black text-limeu-dark">${team.best_streak}</div><div class="text-xs text-muted">Best Streak</div></div>
        <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-2xl font-black text-charcoal">${team.streak_saves}</div><div class="text-xs text-muted">Streak Saves Left</div></div>
        <div class="bg-white rounded-2xl border border-gray-200 p-4"><div class="text-2xl font-black text-charcoal">${pushedToday}/${members.length}</div><div class="text-xs text-muted">Pushed Today (quorum ${quorum})</div></div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-200 p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-sm text-charcoal">Today's Team</h2>
          <button type="button" onclick="refreshChallenge()" class="text-xs font-semibold text-limeu-dark">Refresh</button>
        </div>
        <div class="space-y-2">
          ${members.length ? members.map((m) => `
            <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-canvas border border-gray-200">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-8 h-8 rounded-full bg-charcoal text-limeu font-bold text-[11px] flex items-center justify-center shrink-0">${escapeHtml(API.initialsOf(m.name))}</div>
                <div class="min-w-0">
                  <div class="text-xs font-bold text-charcoal truncate">${escapeHtml(m.name)}</div>
                  <div class="text-[11px] text-muted truncate">@${escapeHtml(m.githubLogin || "github")}</div>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${m.pushed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}">${m.pushed ? "Pushed ✓" : "Not yet"}</span>
            </div>`).join("") : '<div class="text-xs text-muted">No members yet.</div>'}
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 class="font-bold text-sm text-charcoal mb-3">Recent Activity</h2>
        <div class="space-y-2">
          ${c.events.length ? c.events.map((ev) => `
            <div class="text-xs p-2.5 rounded-xl bg-canvas border border-gray-200">
              <span class="font-bold text-charcoal">${escapeHtml(String(ev.type || "").replace(/_/g, " "))}</span> — ${escapeHtml(ev.message)} <span class="text-muted">${escapeHtml(API.formatTime(ev.created_at))}</span>
            </div>`).join("") : '<div class="text-xs text-muted">No activity yet.</div>'}
        </div>
      </div>
    </div>`;
}

async function connectGitHub() {
  try {
    const { error } = await window.sb.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (err) {
    toastError(err);
  }
}

async function connectWithToken(e) {
  e.preventDefault();
  const token = (document.getElementById("ghToken") || {}).value.trim();
  if (!token) return;

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Verifying…";
  }

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "CollabU",
        Accept: "application/vnd.github+json"
      }
    });
    if (!res.ok) throw new Error("GitHub token is invalid or expired");

    const user = await res.json();
    await API.storeGithubConnection(state.user.id, {
      githubId: user.id,
      githubLogin: user.login,
      avatarUrl: user.avatar_url,
      accessToken: token,
      tokenScope: "personal-access-token"
    });

    await loadChallenge();
    showToast("GitHub connected as @" + user.login);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Connect with Token";
    }
    toastError(err);
  }
}

async function createChallengeTeam(e) {
  e.preventDefault();
  const name = (document.getElementById("challengeName") || {}).value.trim();
  const repo = (document.getElementById("challengeRepo") || {}).value.trim();
  if (!name || !repo) return;
  try {
    await API.createChallengeTeam(name, repo);
    await loadChallenge();
    showToast("Team created! Share the invite code.");
  } catch (err) {
    toastError(err);
  }
}

async function joinChallengeTeam(e) {
  e.preventDefault();
  const code = (document.getElementById("challengeCode") || {}).value.trim();
  if (!code) return;
  try {
    await API.joinChallengeTeam(code);
    await loadChallenge();
    showToast("Joined the challenge!");
  } catch (err) {
    toastError(err);
  }
}

async function leaveChallengeTeam() {
  if (!state.challenge.team) return;
  try {
    await API.leaveChallengeTeam(state.challenge.team.id);
    state.challenge = {
      loading: false,
      loaded: true,
      connection: state.challenge.connection,
      team: null,
      members: [],
      days: [],
      events: []
    };
    renderChallenges();
    showToast("Left the challenge");
  } catch (err) {
    toastError(err);
  }
}

async function refreshChallenge() {
  await loadChallenge();
}

async function copyInviteCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showToast("Invite code copied");
  } catch (_) {
    showToast("Invite code: " + code);
  }
}

/* --------------------------------------------------------------- AI helpers */

async function aiCoachPitch(projId) {
  const pitch = (document.getElementById("applyPitch") || {}).value.trim();
  const project = state.projects.find((p) => p.id === projId);
  if (!pitch) {
    showToast("Write your pitch first");
    return;
  }

  const result = document.getElementById("pitchCoachResult");
  if (result) {
    result.classList.remove("hidden");
    result.textContent = "Thinking…";
  }

  try {
    const text = await AI.coachPitch(pitch, project);
    if (result) result.textContent = text;
  } catch (err) {
    if (result) result.textContent = "AI unavailable. Please try again later.";
    toastError(err);
  }
}

async function aiValidateIdea() {
  const idea = {
    title: (document.getElementById("newTitle") || {}).value.trim(),
    tagline: (document.getElementById("newTagline") || {}).value.trim(),
    description: (document.getElementById("newDesc") || {}).value.trim(),
    category: (document.getElementById("newCat") || {}).value,
    skills: ((document.getElementById("newSkills") || {}).value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    neededRoles: ((document.getElementById("newRoles") || {}).value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  };

  if (!idea.title || !idea.description) {
    showToast("Add a title and description first");
    return;
  }

  const result = document.getElementById("ideaCoachResult");
  if (result) {
    result.classList.remove("hidden");
    result.textContent = "Thinking…";
  }

  try {
    const text = await AI.validateIdea(idea);
    if (result) result.textContent = text;
  } catch (err) {
    if (result) result.textContent = "AI unavailable. Please try again later.";
    toastError(err);
  }
}

async function aiSummarizeChat(projId) {
  const project = state.projects.find((p) => p.id === projId);
  if (!project || !project.messages || !project.messages.length) {
    showToast("No messages to summarize yet");
    return;
  }

  try {
    const text = await AI.summarizeChat(project.messages);
    openModal(`
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-black text-charcoal">AI Standup Summary</h2>
        <button type="button" onclick="closeModal()" class="p-1.5 rounded-full hover:bg-canvas text-muted">✕</button>
      </div>
      <div class="text-sm text-charcoal whitespace-pre-line">${escapeHtml(text)}</div>
      <p class="text-[11px] text-muted mt-3">Generated by a free AI model. Review before acting.</p>
    `);
  } catch (err) {
    toastError(err);
  }
}

async function aiSummarizeProject(projId) {
  const project = state.projects.find((p) => p.id === projId);
  if (!project) return;

  const result = document.getElementById("projectAiSummary");
  if (result) {
    result.classList.remove("hidden");
    result.textContent = "Thinking…";
  }

  try {
    const text = await AI.summarizeProject(project);
    if (result) result.textContent = text;
  } catch (err) {
    if (result) result.textContent = "AI unavailable. Please try again later.";
    toastError(err);
  }
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (!el || document.activeElement === el) return;
  el.value = value == null ? "" : value;
}

function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function renderDashboard() {
  if (!state.user) return;
  const u = state.user;

  const navAvatar = document.getElementById("navAvatar");
  if (navAvatar) {
    navAvatar.textContent = u.avatarUrl ? "" : u.initials;
    if (navAvatar.style) {
      navAvatar.style.backgroundImage = u.avatarUrl ? `url("${u.avatarUrl}")` : "";
      navAvatar.style.backgroundSize = "cover";
      navAvatar.style.backgroundPosition = "center";
    }
  }
  const navName = document.getElementById("navUserName");
  if (navName) {
    const parts = u.name.split(" ");
    navName.textContent = parts[0] + (parts[1] ? " " + parts[1][0] + "." : "");
  }

  const activeCount = myProjects().length;
  const completedProjects = state.projects.filter((p) => p.completed).length;
  const completedEvents = state.events.filter((e) => e.completed).length;
  const stats = document.getElementById("dashStats");
  if (stats) {
    stats.innerHTML = `
      <div class="bg-white rounded-2xl border border-gray-200 p-5"><div class="text-2xl font-black text-charcoal">${activeCount}</div><div class="text-xs text-muted mt-0.5">Active Teams</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-5"><div class="text-2xl font-black text-charcoal">${state.applications.length}</div><div class="text-xs text-muted mt-0.5">Applications Tracked</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-5"><div class="text-2xl font-black text-limeu-dark">${completedProjects}</div><div class="text-xs text-muted mt-0.5">Completed Projects</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-5"><div class="text-2xl font-black text-limeu-dark">${completedEvents}</div><div class="text-xs text-muted mt-0.5">Completed Events</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-5"><div class="text-2xl font-black text-charcoal">${state.savedIds.length}</div><div class="text-xs text-muted mt-0.5">Saved Ideas</div></div>
      <div class="bg-white rounded-2xl border border-gray-200 p-5"><div class="text-2xl font-black text-charcoal">${u.skills.length}</div><div class="text-xs text-muted mt-0.5">Verified Skills</div></div>`;
  }

  setValue("profName", u.name);
  setValue("profCollege", u.college);
  setValue("profDept", u.department);
  setValue("profSem", u.semester);
  setValue("profRole", u.role);
  setValue("profAvailability", u.availability);
  setValue("profSkills", (u.skills || []).join(", "));
  setValue("profInterests", (u.interests || []).join(", "));
  setValue("profAchievements", u.achievements);
  setValue("profBio", u.bio);
  setChecked("profCrossInvite", u.allowCrossCollege);
  setChecked("profShowEdu", u.showEduPublic);

  const preview = document.getElementById("profAvatarPreview");
  if (preview) {
    preview.textContent = u.avatarUrl ? "" : u.initials;
    if (preview.style) {
      preview.style.backgroundImage = u.avatarUrl ? `url("${u.avatarUrl}")` : "";
    }
  }

  const form = document.getElementById("profileForm");
  if (form && !document.getElementById("signOutBtn")) {
    const wrap = document.createElement("div");
    wrap.className = "flex items-center gap-3 pt-1";
    wrap.innerHTML =
      '<button type="button" id="signOutBtn" onclick="signOutApp()" class="px-5 py-2.5 rounded-full border border-gray-300 text-xs font-semibold text-muted hover:text-red-600 hover:border-red-300">Sign out</button>';
    form.appendChild(wrap);
  }

  const appsList = document.getElementById("myApplicationsList");
  if (appsList) {
    appsList.innerHTML = state.applications.length
      ? state.applications
          .map(
            (a) => `
        <div class="p-3 rounded-xl bg-canvas border border-gray-200 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-charcoal">${escapeHtml(a.projectTitle)}</div>
            <div class="text-muted">Role: ${escapeHtml(a.role)} • ${escapeHtml(a.date)}</div>
          </div>
          <span class="px-2.5 py-1 rounded-full font-bold ${a.status === "Accepted" ? "bg-emerald-100 text-emerald-800" : a.status === "Rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}">${escapeHtml(a.status)}</span>
        </div>`
          )
          .join("")
      : '<div class="text-xs text-muted">No applications submitted yet.</div>';
  }

  const savedList = document.getElementById("mySavedList");
  if (savedList) {
    const savedProjects = state.projects.filter((p) => state.savedIds.includes(p.id));
    savedList.innerHTML = savedProjects.length
      ? savedProjects
          .map(
            (p) => `
        <div class="p-3 rounded-xl bg-canvas border border-gray-200 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-charcoal">${escapeHtml(p.title)}</div>
            <div class="text-muted">${escapeHtml(p.college)} • ${escapeHtml(p.category)}</div>
          </div>
          <button type="button" onclick="openProjectModal('${p.id}')" class="font-bold text-limeu-dark hover:underline">Open →</button>
        </div>`
          )
          .join("")
      : '<div class="text-xs text-muted">No saved opportunities yet.</div>';
  }

  const blocked = state.blockedUsers || [];
  const blockedList = document.getElementById("blockedUsersList");
  if (blockedList) {
    blockedList.innerHTML = blocked.length
      ? blocked
          .map(
            (bu) => `
        <div class="p-3 rounded-xl bg-canvas border border-gray-200 flex items-center justify-between text-xs">
          <div class="min-w-0">
            <div class="font-bold text-charcoal truncate">${escapeHtml(bu.name)}</div>
            <div class="text-muted truncate">${escapeHtml(bu.college || "")}</div>
          </div>
          <button type="button" onclick="unblockUser('${bu.id}')" class="text-xs font-semibold text-limeu-dark shrink-0">Unblock</button>
        </div>`
          )
          .join("")
      : '<div class="text-xs text-muted">No blocked users.</div>';
  }

  renderConnections();
}

async function saveUserProfile(e) {
  e.preventDefault();
  const name = (document.getElementById("profName") || {}).value.trim();
  if (!name) return;

  const patch = {
    name,
    college: (document.getElementById("profCollege") || {}).value.trim(),
    department: (document.getElementById("profDept") || {}).value.trim(),
    semester: (document.getElementById("profSem") || {}).value.trim(),
    role: (document.getElementById("profRole") || {}).value || "Student",
    availability: (document.getElementById("profAvailability") || {}).value || "Open to Collaborate",
    skills: ((document.getElementById("profSkills") || {}).value || "").split(",").map((s) => s.trim()).filter(Boolean),
    interests: ((document.getElementById("profInterests") || {}).value || "").split(",").map((s) => s.trim()).filter(Boolean),
    achievements: (document.getElementById("profAchievements") || {}).value.trim(),
    bio: (document.getElementById("profBio") || {}).value.trim(),
    allow_cross_college: !!(document.getElementById("profCrossInvite") || {}).checked,
    show_edu_public: !!(document.getElementById("profShowEdu") || {}).checked
  };

  try {
    const updated = await API.updateProfile(state.user.id, patch);
    state.user = shapeUser(updated);
    renderDashboard();
    scheduleRefresh();
    showToast("Profile & Smart Match preferences updated!");
  } catch (err) {
    toastError(err);
  }
}

async function handleAvatarChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !state.user) return;
  if (!file.type || !file.type.startsWith("image/")) {
    showToast("Please choose an image file");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image must be smaller than 5 MB");
    return;
  }

  // Instant local preview before upload.
  const preview = document.getElementById("profAvatarPreview");
  if (preview) {
    const reader = new FileReader();
    reader.onload = () => {
      preview.textContent = "";
      preview.style.backgroundImage = `url("${reader.result}")`;
      preview.style.backgroundSize = "cover";
      preview.style.backgroundPosition = "center";
    };
    reader.readAsDataURL(file);
  }

  try {
    const url = await API.uploadAvatar(state.user.id, file);
    const updated = await API.updateProfile(state.user.id, { avatar_url: url });
    state.user = shapeUser(updated);
    renderDashboard();
    showToast("Profile photo updated");
  } catch (err) {
    toastError(err);
  }
}

/* ------------------------------------------------------------------ modals */

function openModal(html) {
  const content = document.getElementById("modalContent");
  const backdrop = document.getElementById("modalBackdrop");
  if (!content || !backdrop) return;
  content.innerHTML = html;
  backdrop.classList.remove("hidden");
}

function closeModal() {
  const backdrop = document.getElementById("modalBackdrop");
  if (backdrop) backdrop.classList.add("hidden");
}

function openPostIdeaModal() {
  openModal(`
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-xl font-black text-charcoal">Post a New Project Idea</h2>
      <button type="button" onclick="closeModal()" class="p-1.5 rounded-full hover:bg-canvas text-muted">✕</button>
    </div>
    <form onsubmit="submitNewIdea(event)" class="space-y-4 text-sm">
      <div>
        <label class="block text-xs font-bold uppercase text-muted mb-1">Project Title</label>
        <input id="newTitle" type="text" required placeholder="e.g. CampusGPT Study Buddy" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200" />
      </div>
      <div>
        <label class="block text-xs font-bold uppercase text-muted mb-1">One-Line Tagline</label>
        <input id="newTagline" type="text" required placeholder="e.g. Collaborative flashcard & quiz generator for exam prep" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200" />
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold uppercase text-muted mb-1">Category</label>
          <select id="newCat" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200">
            <option>AI & ML</option><option>Web Dev</option><option>Mobile & App</option><option>Robotics & HW</option>
            <option>Design & UI</option><option>Startups</option><option>Academic Research</option><option>Gaming & AR</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-muted mb-1">Project Type</label>
          <select id="newType" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200">
            <option>Startup</option><option>Hackathon</option><option>Research Paper</option><option>Open Source</option><option>Creative Experiment</option>
          </select>
        </div>
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold uppercase text-muted mb-1">Required Skills (comma-separated)</label>
          <input id="newSkills" type="text" required placeholder="React, Python, Figma" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200" />
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-muted mb-1">Needed Roles (comma-separated)</label>
          <input id="newRoles" type="text" required placeholder="Frontend Dev, UI Designer" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200" />
        </div>
      </div>
<div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-bold uppercase text-muted">Detailed Description</label>
          <button type="button" onclick="aiValidateIdea()" class="text-[11px] font-bold text-limeu-dark">AI Idea Check</button>
        </div>
        <textarea id="newDesc" rows="3" required placeholder="Explain what you want to build and the impact..." class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200"></textarea>
        <div id="ideaCoachResult" class="hidden mt-2 text-xs p-3 rounded-xl bg-limeu-soft/50 border border-limeu/30 text-charcoal whitespace-pre-line"></div>
      </div>
      <label class="inline-flex items-center gap-2 text-xs font-semibold text-charcoal">
        <input id="newCross" type="checkbox" checked class="accent-charcoal" />
        <span>Open to cross-college collaborators</span>
      </label>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-5 py-2.5 rounded-full border border-gray-300 text-xs font-semibold">Cancel</button>
        <button type="submit" class="px-6 py-2.5 rounded-full bg-charcoal text-white text-xs font-semibold hover:bg-neutral-800">Publish Idea & Create Workspace →</button>
      </div>
    </form>`);
}

async function submitNewIdea(e) {
  e.preventDefault();
  const title = ((document.getElementById("newTitle") || {}).value || "").trim();
  if (!title) return;

  const input = {
    num: String(state.projects.length + 1).padStart(2, "0"),
    title,
    tagline: (document.getElementById("newTagline") || {}).value.trim(),
    description: (document.getElementById("newDesc") || {}).value.trim(),
    category: (document.getElementById("newCat") || {}).value,
    type: (document.getElementById("newType") || {}).value,
    commitment: "Part-time (5-10h/wk)",
    college: state.user.college,
    crossCollege: !!(document.getElementById("newCross") || {}).checked,
    skills: ((document.getElementById("newSkills") || {}).value || "").split(",").map((s) => s.trim()).filter(Boolean),
    neededRoles: ((document.getElementById("newRoles") || {}).value || "").split(",").map((s) => s.trim()).filter(Boolean),
    teamSize: 4
  };

  try {
    const created = await API.createProject(input, state.user.id);
    state.activeWorkspaceId = created.id;
    await refreshAll();
    closeModal();
    navigateTo("explore");
    showToast('"' + title + '" is now live in the Marketplace!');
  } catch (err) {
    toastError(err);
  }
}

function openProjectModal(projId) {
  const p = state.projects.find((x) => x.id === projId);
  if (!p) return;
  const isMember = (p.memberIds || []).includes(state.user.id) || p.creatorId === state.user.id;

  openModal(`
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <span class="px-2.5 py-0.5 rounded-full bg-limeu-soft text-limeu-dark text-[11px] font-bold">${escapeHtml(p.category)} • ${escapeHtml(p.type)}</span>
        <h2 class="text-2xl font-black text-charcoal mt-1.5">${escapeHtml(p.title)}</h2>
        <p class="text-xs text-muted mt-0.5">Led by ${escapeHtml(p.creatorName)} (${escapeHtml(p.college)})</p>
      </div>
      <button type="button" onclick="closeModal()" class="p-1.5 rounded-full hover:bg-canvas text-muted">✕</button>
    </div>
    <div class="flex items-center justify-between mb-1">
      <span class="text-xs font-bold text-muted uppercase">About the project</span>
      <button type="button" onclick="aiSummarizeProject('${p.id}')" class="text-[11px] font-bold text-limeu-dark">AI Summary</button>
    </div>
    <p class="text-sm text-charcoal leading-relaxed mb-2">${escapeHtml(p.description)}</p>
    <div id="projectAiSummary" class="hidden mb-4 text-xs p-3 rounded-xl bg-limeu-soft/50 border border-limeu/30 text-charcoal whitespace-pre-line"></div>
    <div class="grid sm:grid-cols-2 gap-3 mb-5 text-xs">
      <div class="p-3 rounded-xl bg-canvas border border-gray-200"><span class="font-bold block text-charcoal mb-1">Skills Needed</span>${p.skills.map((s) => escapeHtml(s)).join(", ")}</div>
      <div class="p-3 rounded-xl bg-canvas border border-gray-200"><span class="font-bold block text-charcoal mb-1">Open Roles (${p.members.length}/${p.teamSize} filled)</span>${p.neededRoles.map((r) => escapeHtml(r)).join(", ")}</div>
    </div>
    ${isMember ? `
      <button type="button" onclick="closeModal(); selectWorkspace('${p.id}'); navigateTo('workspaces')" class="w-full py-3 rounded-full bg-charcoal text-white text-sm font-semibold">Open Project Workspace →</button>
    ` : `
      <form onsubmit="submitApplication(event, '${p.id}')" class="space-y-3 pt-3 border-t border-gray-100">
        <div class="font-bold text-sm text-charcoal">Request to Join Team</div>
        <select id="applyRole" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm">
          ${p.neededRoles.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")}
        </select>
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold text-muted uppercase">Your pitch</label>
          <button type="button" onclick="aiCoachPitch('${p.id}')" class="text-[11px] font-bold text-limeu-dark">AI Pitch Coach</button>
        </div>
        <textarea id="applyPitch" rows="2" required placeholder="Briefly share why you'd be a great fit..." class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200 text-sm"></textarea>
        <div id="pitchCoachResult" class="hidden text-xs p-3 rounded-xl bg-limeu-soft/50 border border-limeu/30 text-charcoal whitespace-pre-line"></div>
        <button type="submit" class="w-full py-3 rounded-full bg-charcoal hover:bg-neutral-800 text-white text-sm font-semibold">Send Collaboration Request →</button>
      </form>
    `}
    <div class="flex items-center justify-between gap-2 pt-2">
      ${p.creatorId === state.user.id
        ? `<button type="button" onclick="deleteProject('${p.id}')" class="text-xs font-semibold text-red-600 hover:underline">Delete Project</button>`
        : `<span></span><button type="button" onclick="openReportModal('project', '${p.id}', '${escapeHtml(p.title)}')" class="text-xs font-semibold text-muted hover:text-red-600">Report</button>`}
    </div>
  `);
}

async function submitApplication(e, projId) {
  e.preventDefault();
  const p = state.projects.find((x) => x.id === projId);
  if (!p) return;
  const role = (document.getElementById("applyRole") || {}).value || "Member";
  const pitch = ((document.getElementById("applyPitch") || {}).value || "").trim();

  try {
    await API.createApplication(projId, state.user.id, role, pitch);
    await refreshAll();
    closeModal();
    showToast("Collaboration request sent to " + p.title + "!");
  } catch (err) {
    if (err && err.code === "23505") {
      showToast("You already applied to this project.");
      closeModal();
      return;
    }
    toastError(err);
  }
}

function openStudentModal(stuId) {
  const s = state.students.find((x) => x.id === stuId);
  if (!s) return;
  const myOwned = state.projects.filter((p) => p.creatorId === state.user.id);
  const avatar = s.avatarUrl
    ? `<img src="${s.avatarUrl}" alt="${escapeHtml(s.name)}" class="w-12 h-12 rounded-full object-cover" />`
    : `<div class="w-12 h-12 rounded-full bg-charcoal text-limeu font-black flex items-center justify-center">${escapeHtml(s.initials)}</div>`;

  openModal(`
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center gap-3">
        ${avatar}
        <div>
          <h2 class="text-xl font-black text-charcoal">${escapeHtml(s.name)} ${s.verified ? '<span class="text-emerald-600 text-sm">✓ Verified</span>' : ""}</h2>
          <p class="text-xs text-muted">${escapeHtml(s.college)}${s.dept ? " • " + escapeHtml(s.dept) : ""}${s.sem ? " (" + escapeHtml(s.sem) + ")" : ""}</p>
        </div>
      </div>
      <button type="button" onclick="closeModal()" class="p-1.5 rounded-full hover:bg-canvas text-muted">✕</button>
    </div>
    <p class="text-sm text-charcoal mb-3">${escapeHtml(s.bio)}</p>
    <div class="p-3 rounded-xl bg-limeu-soft/50 text-xs font-semibold text-charcoal mb-4">🏅 ${escapeHtml(s.achievements)}</div>
    <div class="flex flex-wrap gap-1.5 mb-5">
      ${s.skills.map((sk) => `<span class="px-2.5 py-1 rounded-full bg-canvas border border-gray-200 text-xs font-semibold">${escapeHtml(sk)}</span>`).join("")}
    </div>
    <div class="pt-4 border-t border-gray-100 flex flex-col sm:flex-row gap-2 justify-between items-center">
      <div class="flex gap-2 w-full sm:w-auto">
        <select id="inviteProjSel" class="px-3 py-2 rounded-xl bg-canvas border border-gray-200 text-xs flex-1">
          ${myOwned.length ? myOwned.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join("") : '<option value="">No projects yet</option>'}
        </select>
        <button type="button" onclick="inviteStudentToProj('${s.id}')" class="px-4 py-2 rounded-xl bg-charcoal text-white text-xs font-semibold">Invite</button>
      </div>
      <div class="flex gap-3 text-xs">
        <button type="button" onclick="openReportModal('user', '${s.id}', '${escapeHtml(s.name)}')" class="text-muted hover:text-red-600 font-semibold">Report</button>
        <button type="button" onclick="blockStudent('${s.id}')" class="text-muted hover:text-red-600 font-semibold">Block User</button>
      </div>
    </div>`);
}

async function inviteStudentToProj(stuId) {
  const s = state.students.find((x) => x.id === stuId);
  closeModal();
  try {
    await API.connect(state.user.id, stuId);
    showToast("Invitation sent to " + (s ? s.name : "student") + "!");
  } catch (err) {
    toastError(err);
  }
}

async function blockStudent(id) {
  const student = state.students.find((s) => s.id === id);
  try {
    await API.blockUser(state.user.id, id);
    state.blockedIds.push(id);
    closeModal();
    renderTeammates();
    showToast((student ? student.name : "User") + " has been blocked.");
  } catch (err) {
    toastError(err);
  }
}

function openOrganizeEventModal() {
  openModal(`
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-black text-charcoal">Organize Hackathon or Workshop</h2>
      <button type="button" onclick="closeModal()" class="p-1.5 rounded-full hover:bg-canvas text-muted">✕</button>
    </div>
    <form onsubmit="submitNewEvent(event)" class="space-y-3 text-sm">
      <input id="evTitle" type="text" required placeholder="Event Title" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200" />
      <div class="grid sm:grid-cols-2 gap-3">
        <input id="evDate" type="text" required placeholder="Date (e.g. Jan 15, 2027)" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200" />
        <select id="evTag" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200">
          <option>Hackathon</option><option>Workshop</option><option>Startup Pitch</option><option>Research Seminar</option>
        </select>
      </div>
      <textarea id="evDesc" rows="2" required placeholder="What will students build or learn?" class="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-gray-200"></textarea>
      <button type="submit" class="w-full py-2.5 rounded-full bg-charcoal text-white font-semibold">Publish Event →</button>
    </form>`);
}

async function submitNewEvent(e) {
  e.preventDefault();
  const input = {
    title: (document.getElementById("evTitle") || {}).value.trim(),
    date: (document.getElementById("evDate") || {}).value.trim(),
    tag: (document.getElementById("evTag") || {}).value,
    desc: (document.getElementById("evDesc") || {}).value.trim()
  };
  try {
    await API.createEvent(input, state.user.id);
    await refreshAll();
    closeModal();
    renderHackathons();
    showToast("Event published to community!");
  } catch (err) {
    toastError(err);
  }
}

/* ------------------------------------------------------------------ render */

function renderCurrentView() {
  if (!state.user) return;
  renderNotifications();
  switch (state.currentView) {
    case "home":
      renderHome();
      break;
    case "explore":
      renderMarketplace();
      break;
    case "teammates":
      renderTeammates();
      break;
    case "workspaces":
      renderWorkspaces();
      break;
    case "hackathons":
      renderHackathons();
      break;
    case "challenges":
      renderChallenges();
      break;
    case "dashboard":
      renderDashboard();
      break;
    default:
      renderHome();
  }
}

/* --------------------------------------------------------------- lifecycle */

async function storeGithubSessionIfAny() {
  const session = window.__COLLABU_SESSION__;
  if (!session || !session.provider_token) return;
  if ((session.user.app_metadata || {}).provider !== "github") return;

  const meta = session.user.user_metadata || {};
  const login = meta.user_name || meta.preferred_username || meta.name;
  if (!login) return;

  try {
    await API.storeGithubConnection(session.user.id, {
      githubId: meta.user_id || meta.sub,
      githubLogin: login,
      avatarUrl: meta.avatar_url,
      accessToken: session.provider_token,
      tokenScope: session.provider_scope || ""
    });
    state.challenge.loaded = false;
    if (state.currentView === "challenges") loadChallenge();
  } catch (err) {
    console.warn("[CollabU] GitHub connection save failed", err);
  }
}

function ensureProfile() {
  const u = state.user;
  if (!u) return;
  if (!u.name || !u.college || !u.skills.length) {
    navigateTo("dashboard");
    showToast("Welcome! Complete your profile to unlock smart matching.");
  }
}

async function start() {
  ensureLoader();
  showLoader(true);
  try {
    await loadData();
    await storeGithubSessionIfAny();
    navigateTo(parseHash(), true);
    ensureProfile();
  } catch (err) {
    console.error("[CollabU] startup failed", err);
    showToast("Could not load your data. Verify js/config.js and your Supabase schema.");
  } finally {
    showLoader(false);
  }

  window.Realtime.subscribe({
    onChange: (table) => {
      if (table && table.indexOf("challenge_") === 0) {
        state.challenge.loaded = false;
      }
      scheduleRefresh();
    }
  });
  if (window.Push) window.Push.init().catch(() => {});
}

function stop() {
  window.Realtime.unsubscribe();
  state.user = null;
  state.projects = [];
  state.students = [];
  state.savedIds = [];
  state.applications = [];
  state.notifications = [];
  state.connections = [];
  state.challenge = { loading: false, loaded: false, connection: null, team: null, members: [], days: [], events: [] };
  state.activeWorkspaceId = null;
  state._knownMyProjectIds = new Set();
  state._initialized = false;
  showLoader(false);
}

async function signOutApp() {
  try {
    await Auth.signOut();
  } catch (err) {
    toastError(err);
  }
}

/* -------------------------------------------------------------------- boot */

function boot() {
  ensureLoader();

  const backdrop = document.getElementById("modalBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", (e) => {
      if (e.target.id === "modalBackdrop") closeModal();
    });
  }

  window.addEventListener("popstate", () => {
    if (!Auth.isAuthenticated()) return;
    const view = parseHash();
    state.currentView = view;
    applyView(view);
    renderCurrentView();
  });

  Auth.init({ onEnter: start, onExit: stop });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

/* --------------------------------------------------------- PWA registration */

if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("[CollabU] service worker registration failed", err);
    });
  });
}

/* ------------------------------------------------- expose for inline handlers */

window.navigateTo = navigateTo;
window.filterByDomain = filterByDomain;
window.toggleMobileMenu = toggleMobileMenu;
window.toggleNotifications = toggleNotifications;
window.markAllNotificationsRead = markAllNotificationsRead;
window.toggleSaveProject = toggleSaveProject;
window.openProjectModal = openProjectModal;
window.openStudentModal = openStudentModal;
window.openPostIdeaModal = openPostIdeaModal;
window.openOrganizeEventModal = openOrganizeEventModal;
window.closeModal = closeModal;
window.selectWorkspace = selectWorkspace;
window.switchWorkspaceTab = switchWorkspaceTab;
window.sendWorkspaceMessage = sendWorkspaceMessage;
window.addWorkspaceTask = addWorkspaceTask;
window.cycleTaskStatus = cycleTaskStatus;
window.addWorkspaceResource = addWorkspaceResource;
window.handleJoinRequest = handleJoinRequest;
window.toggleShowcase = toggleShowcase;
window.switchHackathonTab = switchHackathonTab;
window.toggleEventRSVP = toggleEventRSVP;
window.toggleEventCompleted = toggleEventCompleted;
window.deleteEvent = deleteEvent;
window.deleteProject = deleteProject;
window.openReportModal = openReportModal;
window.submitReport = submitReport;
window.unblockUser = unblockUser;
window.connectGitHub = connectGitHub;
window.connectWithToken = connectWithToken;
window.aiCoachPitch = aiCoachPitch;
window.aiValidateIdea = aiValidateIdea;
window.aiSummarizeChat = aiSummarizeChat;
window.aiSummarizeProject = aiSummarizeProject;
window.createChallengeTeam = createChallengeTeam;
window.joinChallengeTeam = joinChallengeTeam;
window.leaveChallengeTeam = leaveChallengeTeam;
window.refreshChallenge = refreshChallenge;
window.copyInviteCode = copyInviteCode;
window.toggleCommunity = toggleCommunity;
window.connectStudent = connectStudent;
window.acceptConnection = acceptConnection;
window.declineConnection = declineConnection;
window.enablePushNotifications = enablePushNotifications;
window.inviteStudentToProj = inviteStudentToProj;
window.blockStudent = blockStudent;
window.submitApplication = submitApplication;
window.submitNewIdea = submitNewIdea;
window.submitNewEvent = submitNewEvent;
window.saveUserProfile = saveUserProfile;
window.handleAvatarChange = handleAvatarChange;
window.showToast = showToast;
window.signOutApp = signOutApp;