import {
  adminClient,
  verifySecret,
  getGithubActivity,
  notify,
  json
} from "../_shared/streak.ts";

function utcDay(offsetDays: number) {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)
  );
  const day = d.toISOString().slice(0, 10);
  return { day, from: `${day}T00:00:00Z`, to: `${day}T23:59:59Z` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = adminClient();
  if (!(await verifySecret(req, admin))) return json({ error: "unauthorized" }, 401);

  // Evaluate the previous UTC day.
  const { day, from, to } = utcDay(-1);

  const { data: teams, error } = await admin
    .from("challenge_teams")
    .select("*")
    .eq("status", "active");
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];

  for (const team of teams || []) {
    const { data: existing } = await admin
      .from("challenge_days")
      .select("id")
      .eq("team_id", team.id)
      .eq("day", day)
      .maybeSingle();

    if (existing) {
      results.push({ team: team.id, skipped: "already evaluated" });
      continue;
    }

    // New members are eligible the day after they join.
    const dayStart = new Date(`${day}T00:00:00Z`);
    const { data: members } = await admin
      .from("challenge_members")
      .select("user_id, github_login, joined_at")
      .eq("team_id", team.id)
      .lt("joined_at", dayStart.toISOString());

    const eligible = members || [];
    const memberCount = eligible.length;

    if (memberCount === 0) {
      results.push({ team: team.id, skipped: "no eligible members" });
      continue;
    }

    let pushed = 0;

    for (const member of eligible) {
      const { data: conn } = await admin
        .from("github_connections")
        .select("access_token, github_login")
        .eq("user_id", member.user_id)
        .maybeSingle();

      let commits = 0;
      let prs = 0;
      let activityPushed = false;

      if (conn?.access_token) {
        const activity = await getGithubActivity(
          conn.access_token,
          member.github_login || conn.github_login || "",
          team.repo_full_name,
          from,
          to
        );
        commits = activity.commits;
        prs = activity.prs;
        activityPushed = activity.pushed;
      }

      await admin.from("challenge_member_days").upsert(
        {
          team_id: team.id,
          user_id: member.user_id,
          day,
          pushed: activityPushed,
          commits,
          prs,
          checked_at: new Date().toISOString()
        },
        { onConflict: "team_id,user_id,day" }
      );

      if (activityPushed) pushed++;
    }

    const quorum = Math.max(1, Math.ceil(memberCount * 0.6));
    const quorumMet = pushed >= quorum;

    let streak = team.streak_days;
    let saves = team.streak_saves;
    let status = team.status;
    let saveUsed = false;
    let eventType = "streak_extended";
    let message = `${pushed}/${memberCount} members pushed — streak extended to ${team.streak_days + 1}`;

    if (quorumMet) {
      streak = team.streak_days + 1;
    } else if (saves > 0) {
      saves = team.streak_saves - 1;
      saveUsed = true;
      eventType = "save_used";
      message = `Quorum missed (${pushed}/${memberCount}). Streak Save used — ${saves} left.`;
    } else {
      status = "ended";
      eventType = "challenge_ended";
      message = `Quorum missed (${pushed}/${memberCount}) and no Streak Saves left. Challenge ended at ${team.streak_days}.`;
    }

    const best = Math.max(team.best_streak, streak);

    await admin
      .from("challenge_teams")
      .update({
        streak_days: streak,
        best_streak: best,
        streak_saves: saves,
        status,
        last_evaluated: day
      })
      .eq("id", team.id);

    await admin.from("challenge_days").upsert(
      {
        team_id: team.id,
        day,
        pushed_count: pushed,
        member_count: memberCount,
        quorum,
        quorum_met: quorumMet,
        save_used: saveUsed,
        streak_after: streak
      },
      { onConflict: "team_id,day" }
    );

    await admin.from("challenge_events").insert({
      team_id: team.id,
      type: eventType,
      message
    });

    const { data: allMembers } = await admin
      .from("challenge_members")
      .select("user_id")
      .eq("team_id", team.id);

    for (const m of allMembers || []) {
      await notify(admin, m.user_id, message);
    }

    results.push({
      team: team.id,
      day,
      pushed,
      memberCount,
      quorum,
      quorumMet,
      streak,
      saves,
      status
    });
  }

  return json({ evaluated: results.length, day, results });
});