import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, service);
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function verifySecret(req: Request, admin: any): Promise<boolean> {
  const provided = req.headers.get("x-streak-secret");
  if (!provided) return false;
  const { data } = await admin
    .from("app_secrets")
    .select("value")
    .eq("name", "streak_secret")
    .maybeSingle();
  return !!data && data.value === provided;
}

export interface Activity {
  pushed: boolean;
  commits: number;
  prs: number;
  error?: string;
}

/**
 * Counts commits and PRs created in the shared repo during [from, to].
 * Uses GitHub's contributions collection (one GraphQL call per member/day).
 */
export async function getGithubActivity(
  token: string,
  login: string,
  repoFullName: string,
  from: string,
  to: string
): Promise<Activity> {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository {
            repository { nameWithOwner }
            contributions { totalCount }
          }
          pullRequestContributionsByRepository {
            repository { nameWithOwner }
            contributions { totalCount }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "CollabU-Streak"
      },
      body: JSON.stringify({ query, variables: { login, from, to } })
    });

    if (!res.ok) {
      return { pushed: false, commits: 0, prs: 0, error: `GitHub HTTP ${res.status}` };
    }

    const payload = await res.json();
    if (payload.errors) {
      return {
        pushed: false,
        commits: 0,
        prs: 0,
        error: payload.errors[0]?.message || "GitHub error"
      };
    }

    const collection = payload.data?.user?.contributionsCollection;
    if (!collection) return { pushed: false, commits: 0, prs: 0, error: "No user data" };

    const repo = repoFullName.toLowerCase();
    let commits = 0;
    for (const entry of collection.commitContributionsByRepository || []) {
      if (entry.repository?.nameWithOwner?.toLowerCase() === repo) {
        commits += entry.contributions?.totalCount || 0;
      }
    }

    let prs = 0;
    for (const entry of collection.pullRequestContributionsByRepository || []) {
      if (entry.repository?.nameWithOwner?.toLowerCase() === repo) {
        prs += entry.contributions?.totalCount || 0;
      }
    }

    return { pushed: commits + prs > 0, commits, prs };
  } catch (err) {
    return {
      pushed: false,
      commits: 0,
      prs: 0,
      error: String((err as any)?.message || err)
    };
  }
}

export async function sendPush(
  admin: any,
  userId: string,
  title: string,
  body: string
) {
  const { data: config } = await admin
    .from("push_config")
    .select("vapid_public_key, vapid_private_key, vapid_subject")
    .eq("id", true)
    .maybeSingle();
  if (!config) return;

  try {
    webpush.setVapidDetails(
      config.vapid_subject,
      config.vapid_public_key,
      config.vapid_private_key
    );
  } catch (_) {
    return;
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  const payload = JSON.stringify({ title, body, url: "/#challenges" });

  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status;
      if (status === 410 || status === 404) {
        await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }
}

export async function notify(admin: any, userId: string, text: string) {
  const { data } = await admin
    .from("notifications")
    .insert({ user_id: userId, text })
    .select("id")
    .single();
  if (data?.id) await sendPush(admin, userId, "CollabU", text);
}