/*
 * CollabU free AI helpers.
 * Primary: Puter.js (free, no API key, GPT-4o-mini).
 * Fallback: Pollinations.ai (free, no key, lower quality).
 * Final fallback: local rule-based suggestions so features never break.
 * Results are cached in Supabase `ai_cache` to respect free-tier limits.
 */
(function () {
  const _lastCall = {};
  const RATE_MS = 15000;

  function userId() {
    if (window.Auth && window.Auth.getUser) {
      const u = window.Auth.getUser();
      return u ? u.id : null;
    }
    return null;
  }

  function rateLimited() {
    const id = userId();
    if (!id) return false;
    const now = Date.now();
    const last = _lastCall[id] || 0;
    if (now - last < RATE_MS) return true;
    _lastCall[id] = now;
    return false;
  }

  async function hash(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function trim(text, max) {
    const t = String(text || "").trim();
    return t.length > max ? t.slice(0, max) + "…" : t;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("AI timeout")), ms))
    ]);
  }

  async function puterChat(prompt) {
    if (!window.puter || !window.puter.ai || typeof window.puter.ai.chat !== "function") {
      return null;
    }
    const res = await withTimeout(
      window.puter.ai.chat(prompt, { model: "gpt-4o-mini" }),
      15000
    );
    if (typeof res === "string") return res;
    if (res && res.message && typeof res.message.content === "string") return res.message.content;
    if (res && typeof res.text === "string") return res.text;
    if (res && typeof res.content === "string") return res.content;
    if (res && res.message && typeof res.message === "string") return res.message;
    return null;
  }

  async function pollinationsChat(prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(
        `https://text.pollinations.ai/${encodeURIComponent(trim(prompt, 900))}?model=openai`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error("AI HTTP " + res.status);
      const text = await res.text();
      if (!text.trim()) throw new Error("Empty AI response");
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat(prompt) {
    try {
      const p = await puterChat(prompt);
      if (p) return p;
    } catch (_) {}
    return await pollinationsChat(prompt);
  }

  async function cached(prompt, fallback) {
    try {
      const key = await hash(prompt);
      const { data } = await window.sb
        .from("ai_cache")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (data && data.value) return data.value;

      const text = await chat(prompt);
      if (text) {
        await window.sb.from("ai_cache").upsert({ key, value: text }, { onConflict: "key" });
        return text;
      }
    } catch (_) {}
    return fallback();
  }

  function fallbackPitch(pitch, project) {
    const roles = (project?.neededRoles || []).join(", ") || "the listed roles";
    const skills = (project?.skills || []).join(", ") || "the listed skills";
    const p = String(pitch || "").trim();
    if (p.length < 60) {
      return "Strength: you have a starting idea.\nRisk: the pitch is too short to evaluate fit.\nImprove: explain what you will build, the role you want, and one relevant project.";
    }
    const lower = p.toLowerCase();
    const hits =
      (project?.neededRoles || []).filter((r) => lower.includes(String(r).toLowerCase())).length +
      (project?.skills || []).filter((s) => lower.includes(String(s).toLowerCase())).length;
    if (hits === 0) {
      return `Strength: you explained the idea.\nRisk: it does not mention the team's needs (${roles}).\nImprove: name the role you want and one skill from ${skills}.`;
    }
    return "Strength: you mention relevant skills or roles.\nRisk: fit could be clearer for a cross-functional team.\nImprove: add one concrete outcome or project link to stand out.";
  }

  function fallbackIdea(idea) {
    const desc = String(idea.description || idea.tagline || "").trim();
    const first = desc.split(/[.!?]/)[0] || "The idea is clear enough to start.";
    return `Strength: ${first}.\nRisk: scope may be too broad for a student team.\nMVP: ship one core flow first (${idea.category || "your category"}), then add ${(idea.skills || []).slice(0, 2).join(" / ") || "one more feature"}.`;
  }

  function fallbackChat(messages) {
    if (!messages || !messages.length) return "No messages to summarize yet.";
    const last = messages
      .slice(-4)
      .map((m) => `• ${m.sender}: ${trim(m.text, 100)}`)
      .join("\n");
    return `Recent messages:\n${last}\n\nAction: assign owners for any open items and confirm the next milestone.`;
  }

  function fallbackProject(project) {
    const desc = String(project?.description || "").trim();
    const first = desc.split(/[.!?]/).slice(0, 2).join(". ").trim() || "A student-built project.";
    return `${first}. Built by ${project?.creatorName || "a student"} at ${project?.college || "their campus"}.`;
  }

  async function coachPitch(pitch, project) {
    const prompt =
      `You are a concise pitch coach for student teams. Give exactly 3 short lines: ` +
      `"Strength:", "Risk:", "Improve:". Project: ${project?.title || ""}; ` +
      `needed roles: ${(project?.neededRoles || []).join(", ")}; ` +
      `skills: ${(project?.skills || []).join(", ")}. Pitch: ${pitch}`;
    return await cached(prompt, () => fallbackPitch(pitch, project));
  }

  async function validateIdea(idea) {
    const prompt =
      `You are a startup mentor. In exactly 3 short lines: "Strength:", "Risk:", "MVP:". ` +
      `Assess this student project idea. Title: ${idea.title}; tagline: ${idea.tagline}; ` +
      `description: ${trim(idea.description, 400)}; category: ${idea.category}; ` +
      `roles: ${(idea.neededRoles || []).join(", ")}.`;
    return await cached(prompt, () => fallbackIdea(idea));
  }

  async function summarizeChat(messages) {
    const text = (messages || []).map((m) => `${m.sender}: ${m.text}`).join("\n");
    const prompt =
      `Summarize this student team chat in 3 short bullets: "Decided:", "In progress:", "Action:". Chat:\n` +
      trim(text, 1200);
    return await cached(prompt, () => fallbackChat(messages));
  }

  async function summarizeProject(project) {
    const prompt =
      `Summarize this student project in exactly 2 sentences for a showcase. ` +
      `Title: ${project?.title}; description: ${trim(project?.description, 500)}.`;
    return await cached(prompt, () => fallbackProject(project));
  }

  function fallbackCharter(project, members) {
  return (
    `Mission: ship ${project.title}.\n` +
    `Roles: ${(project.neededRoles || []).join(", ") || "Builder, Designer, QA"}.\n` +
    `Communication: async updates in the workspace + one weekly sync.\n` +
    `Deadlines: agree on a milestone every Friday.\n` +
    `Conflict resolution: discuss blockers in the team chat; escalate to the creator if unresolved.`
  );
}

async function teamCharter(project, members) {
  const prompt =
    `Write a concise team charter for a student project. Include exactly 5 short lines: ` +
    `"Mission:", "Roles:", "Communication:", "Deadlines:", "Conflict resolution:". ` +
    `Project: ${project.title}; team: ${(members || []).join(", ")}.`;
  return await cached(prompt, () => fallbackCharter(project, members));
}

function fallbackRetro(project, messages) {
  const last = (messages || []).slice(-3).map((m) => m.text).join("; ");
  return (
    `What went well: shipped ${project.title} with ${(project.members || []).length} teammates.\n` +
    `What to improve: ${last || "clarify ownership earlier"}.\n` +
    `Next steps: document the setup and publish the repo.`
  );
}

async function retrospective(project, messages) {
  const text = (messages || []).map((m) => `${m.sender}: ${m.text}`).join("\n");
  const prompt =
    `Write a concise retrospective for a student project. Include exactly 3 short lines: ` +
    `"What went well:", "What to improve:", "Next steps:". ` +
    `Project: ${project.title}; recent chat: ${text.slice(0, 1200)}.`;
  return await cached(prompt, () => fallbackRetro(project, messages));
}

window.AI = {
    coachPitch,
    validateIdea,
    summarizeChat,
    summarizeProject,
    teamCharter,
    retrospective,
    isRateLimited: () => rateLimited()
  };
})();