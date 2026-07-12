/* GolHex PWA service worker.
 * Conservative app-shell cache: cache static shell files during install, serve cached
 * same-origin GET requests when offline, and never cache opaque third-party font
 * responses. The Vite build hash still governs JS/CSS cache busting.
 */
const CACHE_NAME = "golhex-app-shell-v2";
const APP_SHELL = [
  "./",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("golhex-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Navigation (HTML document) requests are network-first: a fresh deploy's
// index.html — and therefore its new Vite-hashed asset references — is fetched
// immediately when online, so an old cached shell can never trap a stale app
// version (issue #115). Offline it falls back to the cached shell. Everything
// else stays cache-first: icons/manifest are static and JS/CSS are content-hashed
// (a new build is a new URL, so cache-first never serves stale code).
function networkFirstShell(request) {
  // Network-first so online clients always get the freshly deployed index.html
  // (and, through it, the new hashed asset URLs). We deliberately do NOT write
  // the fetched document back into the shell cache: a fresh index.html can
  // reference hashed JS/CSS that are not cached yet, so persisting it as the
  // offline shell could strand an offline relaunch on markup that points at
  // uncached assets (torn shell). The offline fallback therefore stays the last
  // consistent shell precached at SW install (it advances when a new sw.js
  // version installs). Online freshness fixes the stale-shell trap; offline
  // stays on the last coherent version.
  return fetch(request)
    .catch(() => caches.match(request).then((cached) => cached || caches.match("./")));
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (!response || response.status !== 200 || response.type !== "basic") {
      return response;
    }
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    return response;
  }).catch(() => caches.match("./")));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
