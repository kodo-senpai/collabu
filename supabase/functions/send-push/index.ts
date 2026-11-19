import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Caller-scoped client: verifies the JWT and respects RLS.
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
    const callerId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const notificationId = body.notificationId;
    if (!notificationId) return json({ error: "notificationId required" }, 400);

    const admin = createClient(url, service);

    const { data: notification, error: nError } = await admin
      .from("notifications")
      .select("id, user_id, actor_id, text")
      .eq("id", notificationId)
      .single();

    if (nError || !notification) return json({ error: "notification not found" }, 404);
    if (notification.actor_id !== callerId) return json({ error: "forbidden" }, 403);

    const { data: config, error: cError } = await admin
      .from("push_config")
      .select("vapid_public_key, vapid_private_key, vapid_subject")
      .eq("id", true)
      .single();

    if (cError || !config) return json({ error: "push not configured" }, 503);

    webpush.setVapidDetails(
      config.vapid_subject,
      config.vapid_public_key,
      config.vapid_private_key
    );

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", notification.user_id);

    const payload = JSON.stringify({
      title: "CollabU",
      body: notification.text,
      url: "/"
    });

    let sent = 0;
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (err: any) {
        const status = err?.statusCode ?? err?.status;
        if (status === 410 || status === 404) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }

    return json({ sent });
  } catch (err) {
    console.error("send-push error", err);
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});