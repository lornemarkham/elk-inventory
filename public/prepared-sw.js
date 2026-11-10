// Offline reading for the saved emergency plan (/prepared/offline).
// Network first: online visits always get the live app. Only when the network
// fails does it answer from what it saw last. It never touches /api or the
// database (those are other origins or /api paths).
const CACHE = "elk-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const isShell = req.mode === "navigate" || url.pathname.startsWith("/assets/");
  if (!isShell) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === "navigate" ? "/" : req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req.mode === "navigate" ? "/" : req)) ?? Response.error())
  );
});
