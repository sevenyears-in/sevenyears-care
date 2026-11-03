// Seven Years Care — app service worker.
// Keeps the app installable and shows a friendly page when there is no internet.
// Pages and data always come fresh from the server (nothing private is cached).

const CACHE = "sy-care-v3";
const OFFLINE_URL = "/offline.html";
const SHELL = [OFFLINE_URL, "/app-icon-192.png", "/seven-years-logo-2026.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Page loads: always from the network; offline page if there is no connection.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // App icons / logo: cache first.
  const url = new URL(request.url);
  if (url.origin === self.location.origin && SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

// Tapping an alert notification opens (or focuses) the app on that request.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/staff", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target).catch(() => null);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
