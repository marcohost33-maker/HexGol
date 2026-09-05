/* GolHex PWA service worker.
 *
 * The Vite build emits sw-version.js with a build identity plus the exact
 * content-hashed assets for that build. Importing it makes ordinary app builds
 * visible to the browser's service-worker update algorithm and lets install
 * precache one coherent shell+asset generation.
 */
importScripts("./sw-version.js");

const BUILD_ID = self.__GOLHEX_BUILD__;
const GENERATED_PRECACHE = self.__GOLHEX_PRECACHE__;
if (typeof BUILD_ID !== "string" || BUILD_ID.length === 0 || !Array.isArray(GENERATED_PRECACHE)) {
  throw new Error("GolHex service-worker build metadata missing or invalid");
}

const SAFE_BUILD_ID = BUILD_ID.replace(/[^A-Za-z0-9._-]/g, "_");
const CACHE_PREFIX = "golhex-app-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${SAFE_BUILD_ID}`;
const APP_SHELL = Array.from(new Set([
  "./",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  ...GENERATED_PRECACHE,
]));

self.addEventListener("install", (event) => {
  // Cache.addAll is deliberately all-or-nothing for the build's required shell.
  // If any current hashed asset is unavailable, installation fails and the old
  // worker/cache remains in control instead of activating a torn generation.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  // No unconditional skipWaiting(): old pages may still reference the previous
  // build's hashed/lazy assets. Let them finish under their current worker.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  // No clients.claim(): activation occurs after old controlled clients are gone,
  // preventing an old-page/new-worker split-brain during a build transition.
});

// Navigation requests are network-first so online visits see the newest HTML.
// Offline fallback is HTML and therefore belongs ONLY to navigation requests.
function networkFirstShell(request) {
  return fetch(request).catch(async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) || (await cache.match("./")) || Response.error();
    } catch {
      return Response.error();
    }
  });
}

async function cacheFirst(request, event) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Cache Storage can be unavailable or quota-constrained. That must not turn
    // a healthy network path into an application failure.
    cache = null;
  }

  let response;
  try {
    response = await fetch(request);
  } catch {
    // Never answer a missing JS/CSS/image/font request with the HTML app shell.
    // A network error is correct here; returning HTML would create MIME/type
    // failures and hide the actual missing-asset condition.
    return Response.error();
  }

  if (cache && response && response.status === 200 && response.type === "basic") {
    // Return the successful network response independently of cache persistence.
    // Keep the worker alive for the best-effort write, but swallow storage/quota
    // failures so they cannot discard an otherwise valid response.
    const cacheWrite = cache.put(request, response.clone()).catch(() => undefined);
    event.waitUntil(cacheWrite);
  }
  return response;
}

function authoritativeNetworkRequest(request) {
  // Deployment provenance must bypass the browser HTTP cache as well as Cache
  // Storage. Constructing from the incoming Request preserves method/headers and
  // same-origin credentials while overriding only its HTTP-cache mode.
  return new Request(request, { cache: "no-store" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Provenance/update metadata must be authoritative even when opened directly
  // as a browser navigation. Route this BEFORE the HTML navigation fallback.
  if (url.pathname.endsWith("/version.json") || url.pathname.endsWith("/sw-version.js")) {
    event.respondWith(fetch(authoritativeNetworkRequest(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }

  event.respondWith(cacheFirst(request, event));
});
