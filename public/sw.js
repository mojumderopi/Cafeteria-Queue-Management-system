// Minimal service worker: network-first for HTML, cache fallback.
const CACHE = "smart-queue-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // always network
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});