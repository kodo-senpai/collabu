/*
 * CollabU service worker.
 * App-shell precache + stale-while-revalidate for same-origin static assets.
 * Supabase requests are always network-only so auth/realtime data is never stale.
 */
const VERSION = "collabu-v4";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-maskable.svg",
  "./js/config.js",
  "./js/supabase.js",
  "./js/api.js",
  "./js/auth.js",
  "./js/realtime.js",
  "./js/push.js",
  "./js/ai.js",
  "./js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* Web Push: show a notification even when the app is closed. */
self.addEventListener("push", (event) => {
  let payload = { title: "CollabU", body: "You have a new notification.", url: "./" };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(payload.title || "CollabU", {
      body: payload.body || "You have a new notification.",
      icon: "./assets/icon.svg",
      badge: "./assets/icon.svg",
      tag: "collabu-notification",
      data: { url: payload.url || "./" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "./",
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url === target && "focus" in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

function isSupabase(url) {
  return /(^|\.)supabase\.(co|in)$/.test(url.hostname) || url.hostname.includes("supabase");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept Supabase (auth, REST, realtime, storage).
  if (isSupabase(url)) return;

  // Navigations: network-first, fall back to cached shell for offline use.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});