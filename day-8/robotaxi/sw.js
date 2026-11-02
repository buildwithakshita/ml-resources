// Offline support: after the first visit, everything is served from the phone's cache.
const CACHE = 'mini-robotaxi-v3';
const FILES = ["./", "index.html", "style.css", "manifest.webmanifest", "js/brainview.js", "js/car.js", "js/evolve.js", "js/main.js", "js/nn.js", "js/pretrained.js", "js/track.js", "js/world.js", "vendor/three.module.min.js", "fonts/Montserrat_400Regular.woff2", "fonts/Montserrat_600SemiBold.woff2", "fonts/Montserrat_700Bold.woff2", "fonts/PlayfairDisplay_600SemiBold_Italic.woff2", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // cache first (works offline), then refresh the cache in the background when online
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const fresh = fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
