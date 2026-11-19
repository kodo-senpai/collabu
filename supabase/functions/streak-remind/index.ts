import {
  adminClient,
  verifySecret,
  getGithubActivity,
  notify,
  json
} from "../_shared/streak.ts";

function utcToday() {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const day = d.toISOString().slice(0, 10);
  return { day, from: `${day}T00:00:00Z`, to: `${day}T23:59:59Z` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = adminClient();
  if (!(await verifySecret(req, admin))) return json({ error: "unauthorized" }, 401);

  const { day, from, to } = utcToday();

  const { data: teams } = await admin
    .from("challenge_teams")
    .select("*")
    .eq("status", "active");

  const reminders: any[] = [];

  for (const team of teams || []) {
    const { data: members } = await admin
      .from("challenge_members")
      .select("user_id, github_login, joined_at")
      .eq("team_id", team.id);

    for (const member of members || []) {
      const { data: conn } = await admin
        .from("github_connections")
        .select("access_token, github_login")
        .eq("user_id", member.user_id)
        .maybeSingle();

      if (!conn?.access_token) continue;

      const activity = await getGithubActivity(
        conn.access_token,
        member.github_login || conn.github_login || "",
        team.repo_full_name,
        from,
        to
      );

      await admin.from("challenge_member_days").upsert(
        {
          team_id: team.id,
          user_id: member.user_id,
          day,
          pushed: activity.pushed,
          commits: activity.commits,
          prs: activity.prs,
          checked_at: new Date().toISOString()
        },
        { onConflict: "team_id,user_id,day" }
      );

      if (!activity.pushed) {
        await notify(
          admin,
          member.user_id,
          `Reminder: push to ${team.repo_full_name} before 00:00 UTC to keep the team streak alive.`
        );
        reminders.push({ team: team.id, user: member.user_id });
      }
    }
  }

  return json({ day, reminders: reminders.length });
});