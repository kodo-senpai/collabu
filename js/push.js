/*
 * CollabU Web Push.
 * Subscribes the current browser to push notifications and asks the
 * send-push Edge Function to deliver them. Requires HTTPS (or localhost).
 */
(function () {
  const cfg = window.COLLABU_CONFIG || {};

  function supported() {
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  async function enable() {
    if (!supported()) return false;
    if (!cfg.VAPID_PUBLIC_KEY) {
      console.warn("[CollabU] VAPID_PUBLIC_KEY is not configured");
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY)
      });
    }

    const user = window.Auth && window.Auth.getUser ? window.Auth.getUser() : null;
    if (!user || !window.sb) return true;

    const json = sub.toJSON();
    const { error } = await window.sb.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth
      },
      { onConflict: "user_id,endpoint" }
    );
    if (error) throw error;
    return true;
  }

  async function send(notificationId) {
    if (!window.sb || !notificationId) return;
    try {
      await window.sb.functions.invoke("send-push", { body: { notificationId } });
    } catch (err) {
      console.warn("[CollabU] push send failed", err);
    }
  }

  async function init() {
    if (!supported() || Notification.permission !== "granted") return;
    try {
      await enable();
    } catch (err) {
      console.warn("[CollabU] push init failed", err);
    }
  }

  window.Push = { enable, send, init, supported };
})();