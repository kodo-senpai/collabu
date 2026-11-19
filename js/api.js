/*
 * CollabU data-access layer.
 * Every Supabase call in the app goes through this object, so swapping the
 * backend (or adding caching) only requires editing this file.
 *
 * All functions return plain JSON-shaped data and throw on error.
 * The UI layer (app.js) owns loading/error/empty states.
 */
(function () {
  const sb = () => window.sb;

  /* ------------------------------------------------------------------ utils */

  function groupBy(rows, key) {
    const out = {};
    for (const row of rows || []) {
      (out[row[key]] = out[row[key]] || []).push(row);
    }
    return out;
  }

  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (isNaN(diff)) return "";
    if (diff < 45) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 172800) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function initialsOf(name) {
    return String(name || "Student")
      .split(/\s+/)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "ST";
  }

  /* --------------------------------------------------------------- profiles */

  async function getProfile(userId) {
    const { data, error } = await sb()
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Fallback if the auth trigger ever fails: create the row from the client.
  async function ensureProfile(userId, email) {
    const existing = await getProfile(userId);
    if (existing) return existing;
    const fallbackName = String(email || "Student").split("@")[0] || "Student";
    const { data, error } = await sb()
      .from("profiles")
      .insert({ id: userId, name: fallbackName, initials: initialsOf(fallbackName) })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listProfiles(excludeId) {
    let query = sb().from("profiles").select("*").order("name", { ascending: true });
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function updateProfile(userId, patch) {
    const payload = Object.assign({}, patch, {
      updated_at: new Date().toISOString()
    });
    if (typeof payload.name === "string") {
      payload.initials = initialsOf(payload.name);
    }
    const { data, error } = await sb()
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function uploadAvatar(userId, file) {
    const ext = (String(file.name || "png").split(".").pop() || "png").toLowerCase();
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error } = await sb()
      .storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type || "image/png" });
    if (error) throw error;
    const { data } = sb().storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  }

  /* --------------------------------------------------------------- projects */

  async function listProjects(knownProfiles) {
    const [pRes, mRes, tRes, msgRes, rRes, aRes] = await Promise.all([
      sb().from("projects").select("*").order("created_at", { ascending: false }),
      sb().from("project_members").select("project_id, user_id, role"),
      sb().from("project_tasks").select("*").order("created_at", { ascending: true }),
      sb().from("project_messages").select("*").order("created_at", { ascending: true }).limit(1000),
      sb().from("project_resources").select("*").order("created_at", { ascending: true }),
      sb().from("applications").select("*").order("created_at", { ascending: false })
    ]);

    for (const [name, res] of [
      ["projects", pRes],
      ["members", mRes],
      ["tasks", tRes],
      ["messages", msgRes],
      ["resources", rRes],
      ["applications", aRes]
    ]) {
      if (res.error) {
        console.error("[CollabU] listProjects failed at " + name, res.error);
        throw res.error;
      }
    }

    const profiles = knownProfiles || (await listProfiles());
    const byId = {};
    profiles.forEach((p) => (byId[p.id] = p));

    const membersBy = groupBy(mRes.data, "project_id");
    const tasksBy = groupBy(tRes.data, "project_id");
    const msgsBy = groupBy(msgRes.data, "project_id");
    const resBy = groupBy(rRes.data, "project_id");
    const appsBy = groupBy(aRes.data, "project_id");

    return (pRes.data || []).map((p) => {
      const memberRows = membersBy[p.id] || [];
      const taskRows = tasksBy[p.id] || [];
      const msgRows = msgsBy[p.id] || [];
      const appRows = appsBy[p.id] || [];

      return {
        id: p.id,
        num: p.num || "",
        title: p.title,
        tagline: p.tagline || "",
        description: p.description || "",
        category: p.category || "Other",
        type: p.type || "Startup",
        commitment: p.commitment || "Flexible",
        college: p.college || (byId[p.creator_id] || {}).college || "",
        crossCollege: !!p.cross_college,
        creatorId: p.creator_id,
        creatorName: (byId[p.creator_id] || {}).name || "Creator",
        skills: p.skills || [],
        neededRoles: p.needed_roles || [],
        teamSize: p.team_size || 0,
        members: memberRows.map((m) => (byId[m.user_id] || {}).name || "Member"),
        memberIds: memberRows.map((m) => m.user_id),
        image: p.image_url || "",
        featured: !!p.featured,
        completed: !!p.completed,
        tasks: taskRows.map((t) => ({
          id: t.id,
          title: t.title,
          assignee: t.assignee_id ? (byId[t.assignee_id] || {}).name || "Unassigned" : "Unassigned",
          assigneeId: t.assignee_id,
          status: t.status
        })),
        messages: msgRows.map((m) => ({
          id: m.id,
          sender: (byId[m.sender_id] || {}).name || "Member",
          senderId: m.sender_id,
          text: m.text,
          time: formatTime(m.created_at)
        })),
        resources: (resBy[p.id] || []).map((r) => ({
          id: r.id,
          title: r.title,
          url: r.url
        })),
        pendingRequests: appRows
          .filter((a) => a.status === "Pending")
          .map((a) => ({
            id: a.id,
            applicantId: a.applicant_id,
            name: (byId[a.applicant_id] || {}).name || "Applicant",
            college: (byId[a.applicant_id] || {}).college || "",
            role: a.role,
            pitch: a.pitch
          }))
      };
    });
  }

  async function createProject(input, userId) {
    const { data, error } = await sb()
      .from("projects")
      .insert({
        num: input.num || "",
        title: input.title,
        tagline: input.tagline || "",
        description: input.description || "",
        category: input.category || "AI & ML",
        type: input.type || "Startup",
        commitment: input.commitment || "Part-time (5-10h/wk)",
        college: input.college || "",
        cross_college: !!input.crossCollege,
        creator_id: userId,
        skills: input.skills || [],
        needed_roles: input.neededRoles || [],
        team_size: input.teamSize || 4,
        image_url: input.image || null,
        featured: false,
        completed: false
      })
      .select()
      .single();
    if (error) throw error;

    // The AFTER INSERT trigger adds the creator as a member, a kickoff task,
    // and a system message atomically.
    return data;
  }

  async function updateProject(projectId, patch) {
    const { data, error } = await sb()
      .from("projects")
      .update(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
      .eq("id", projectId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteProject(projectId) {
    const { error } = await sb().from("projects").delete().eq("id", projectId);
    if (error) throw error;
  }

  /* ----------------------------------------------------- tasks / chat / links */

  async function createTask(projectId, title, assigneeId) {
    const { error } = await sb().from("project_tasks").insert({
      project_id: projectId,
      title,
      assignee_id: assigneeId || null,
      status: "To Do"
    });
    if (error) throw error;
  }

  async function updateTaskStatus(taskId, status) {
    const { error } = await sb().from("project_tasks").update({ status }).eq("id", taskId);
    if (error) throw error;
  }

  async function deleteTask(taskId) {
    const { error } = await sb().from("project_tasks").delete().eq("id", taskId);
    if (error) throw error;
  }

  async function sendMessage(projectId, senderId, text) {
    const { data, error } = await sb()
      .from("project_messages")
      .insert({ project_id: projectId, sender_id: senderId, text })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function createResource(projectId, title, url, addedBy) {
    const { error } = await sb().from("project_resources").insert({
      project_id: projectId,
      title,
      url,
      added_by: addedBy || null
    });
    if (error) throw error;
  }

  async function deleteResource(resourceId) {
    const { error } = await sb().from("project_resources").delete().eq("id", resourceId);
    if (error) throw error;
  }

  /* ----------------------------------------------------------- applications */

  async function createApplication(projectId, userId, role, pitch) {
    const { error } = await sb().from("applications").insert({
      project_id: projectId,
      applicant_id: userId,
      role: role || "Member",
      pitch: pitch || "",
      status: "Pending"
    });
    if (error) throw error;

    const { data: project } = await sb()
      .from("projects")
      .select("creator_id, title")
      .eq("id", projectId)
      .maybeSingle();

    if (project && project.creator_id) {
      await notifyUser(project.creator_id, "New collaboration request for " + project.title + ".");
    }
  }

  async function listMyApplications(userId) {
    const { data, error } = await sb()
      .from("applications")
      .select("id, project_id, role, status, created_at, projects(title)")
      .eq("applicant_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((a) => {
      const project = Array.isArray(a.projects) ? a.projects[0] : a.projects;
      return {
        id: a.id,
        projectId: a.project_id,
        projectTitle: (project || {}).title || "Project",
        role: a.role,
        status: a.status,
        date: formatDate(a.created_at)
      };
    });
  }

  async function reviewApplication(applicationId, status, actorId) {
    const { data: app, error } = await sb()
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .single();
    if (error) throw error;

    const { error: upErr } = await sb()
      .from("applications")
      .update({ status })
      .eq("id", applicationId);
    if (upErr) throw upErr;

    if (status === "Accepted") {
      await sb().from("project_members").upsert(
        {
          project_id: app.project_id,
          user_id: app.applicant_id,
          role: app.role || "Member"
        },
        { onConflict: "project_id,user_id", ignoreDuplicates: true }
      );
      await sb().from("project_messages").insert({
        project_id: app.project_id,
        sender_id: actorId,
        text: app.role + " request accepted — welcome to the team!"
      });
    }

    await notifyUser(
      app.applicant_id,
      status === "Accepted"
        ? "Your collaboration request was accepted!"
        : "Your collaboration request was not selected this time."
    );
  }

  /* ---------------------------------------------------------- saved / blocks */

  async function listSavedIds(userId) {
    const { data, error } = await sb().from("saved_items").select("project_id").eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((r) => r.project_id);
  }

  async function setSaved(userId, projectId, saved) {
    if (saved) {
      const { error } = await sb()
        .from("saved_items")
        .insert({ user_id: userId, project_id: projectId });
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await sb()
        .from("saved_items")
        .delete()
        .eq("user_id", userId)
        .eq("project_id", projectId);
      if (error) throw error;
    }
  }

  async function listBlockedIds(userId) {
    const { data, error } = await sb().from("blocks").select("blocked_id").eq("blocker_id", userId);
    if (error) throw error;
    return (data || []).map((r) => r.blocked_id);
  }

  async function blockUser(blockerId, blockedId) {
    const { error } = await sb()
      .from("blocks")
      .insert({ blocker_id: blockerId, blocked_id: blockedId });
    if (error && error.code !== "23505") throw error;
  }

  async function unblockUser(blockerId, blockedId) {
    const { error } = await sb()
      .from("blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);
    if (error) throw error;
  }

  /* ------------------------------------------------------ connections/notifs */

  async function connect(fromId, toId) {
    const { error } = await sb().from("connections").insert({
      from_user: fromId,
      to_user: toId,
      status: "pending"
    });
    if (error && error.code !== "23505") throw error;
    await notifyUser(toId, "You received a collaboration connection request.");
  }

  async function notifyUser(targetUser, body) {
    const { data, error } = await sb().rpc("notify_user", {
      target_user: targetUser,
      body
    });
    if (error) throw error;

    if (data && window.Push && typeof window.Push.send === "function") {
      window.Push.send(data).catch(() => {});
    }
    return data;
  }

  async function listConnections(userId) {
    const { data, error } = await sb()
      .from("connections")
      .select("*")
      .or(`from_user.eq.${userId},to_user.eq.${userId}`)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const profiles = await listProfiles();
    const byId = {};
    profiles.forEach((p) => (byId[p.id] = p));

    return (data || []).map((c) => {
      const incoming = c.to_user === userId;
      const other = byId[incoming ? c.from_user : c.to_user] || {};
      return {
        id: c.id,
        direction: incoming ? "incoming" : "outgoing",
        userId: incoming ? c.from_user : c.to_user,
        name: other.name || "Student",
        initials: other.initials || initialsOf(other.name),
        college: other.college || "",
        status: c.status,
        createdAt: c.created_at
      };
    });
  }

  async function updateConnection(connId, status) {
    const { error } = await sb().from("connections").update({ status }).eq("id", connId);
    if (error) throw error;
  }

  async function deleteConnection(connId) {
    const { error } = await sb().from("connections").delete().eq("id", connId);
    if (error) throw error;
  }

  async function listNotifications(userId) {
    const { data, error } = await sb()
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data || []).map((n) => ({
      id: n.id,
      text: n.text,
      time: formatTime(n.created_at),
      read: !!n.read
    }));
  }

  async function markAllNotificationsRead(userId) {
    const { error } = await sb()
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (error) throw error;
  }

  async function pushNotification(userId, text) {
    const { error } = await sb().from("notifications").insert({ user_id: userId, text });
    if (error) throw error;
  }

  /* ---------------------------------------------------- events/communities */

  async function listEvents(userId) {
    const [eRes, rRes, pRes] = await Promise.all([
      sb().from("events").select("*").order("created_at", { ascending: true }),
      sb().from("event_rsvps").select("event_id").eq("user_id", userId),
      sb().from("profiles").select("id, name, college")
    ]);
    if (eRes.error) throw eRes.error;
    if (rRes.error) throw rRes.error;
    if (pRes.error) throw pRes.error;

    const rsvpSet = new Set((rRes.data || []).map((r) => r.event_id));
    const byId = {};
    (pRes.data || []).forEach((p) => (byId[p.id] = p));

    return (eRes.data || []).map((e) => ({
      id: e.id,
      title: e.title,
      date: e.event_date || "",
      mode: e.mode || "",
      organizer:
        (e.organizer_id && (byId[e.organizer_id] || {}).name) ||
        (e.organizer_id && (byId[e.organizer_id] || {}).college) ||
        "CollabU",
      tag: e.tag || "Event",
      desc: e.description || "",
      registered: rsvpSet.has(e.id)
    }));
  }

  async function createEvent(input, userId) {
    const { data, error } = await sb()
      .from("events")
      .insert({
        title: input.title,
        event_date: input.date || "",
        mode: input.mode || "Online / Campus",
        organizer_id: userId,
        tag: input.tag || "Hackathon",
        description: input.desc || ""
      })
      .select()
      .single();
    if (error) throw error;

    await sb().from("event_rsvps").insert({ event_id: data.id, user_id: userId });
    return data;
  }

  async function setRsvp(eventId, userId, registered) {
    if (registered) {
      const { error } = await sb()
        .from("event_rsvps")
        .insert({ event_id: eventId, user_id: userId });
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await sb()
        .from("event_rsvps")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", userId);
      if (error) throw error;
    }
  }

  async function listCommunities(userId) {
    const [cRes, mRes] = await Promise.all([
      sb().from("communities").select("*").order("name"),
      sb().from("community_members").select("community_id").eq("user_id", userId)
    ]);
    if (cRes.error) throw cRes.error;
    if (mRes.error) throw mRes.error;

    const joined = new Set((mRes.data || []).map((m) => m.community_id));
    return (cRes.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      members: c.member_count + "+ students",
      focus: c.focus || "",
      joined: joined.has(c.id)
    }));
  }

  async function setCommunityMembership(communityId, userId, joined) {
    if (joined) {
      const { error } = await sb()
        .from("community_members")
        .insert({ community_id: communityId, user_id: userId });
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await sb()
        .from("community_members")
        .delete()
        .eq("community_id", communityId)
        .eq("user_id", userId);
      if (error) throw error;
    }
  }

  /* ---------------------------------------------------------------- exports */

  window.API = {
    // profiles
    getProfile,
    ensureProfile,
    listProfiles,
    updateProfile,
    uploadAvatar,
    // projects
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    // collaboration
    createTask,
    updateTaskStatus,
    deleteTask,
    sendMessage,
    createResource,
    deleteResource,
    // applications
    createApplication,
    listMyApplications,
    reviewApplication,
    // saved / blocks / connections
    listSavedIds,
    setSaved,
    listBlockedIds,
    blockUser,
    unblockUser,
    connect,
    notifyUser,
    listConnections,
    updateConnection,
    deleteConnection,
    // notifications
    listNotifications,
    markAllNotificationsRead,
    pushNotification,
    // events / communities
    listEvents,
    createEvent,
    setRsvp,
    listCommunities,
    setCommunityMembership,
    // helpers
    formatTime,
    formatDate,
    initialsOf
  };
})();