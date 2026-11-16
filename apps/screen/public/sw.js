// The screen app's service worker (issue #195): a big screen that reloads
// with no network - a venue's Wi-Fi gone, the TV restarted - still opens and
// shows its set, kept on the device (packages/screen/src/lib/screen-kept.ts).
//
// It keeps the app's code and the screen's page as last loaded, and serves
// the screen's template files (pictures, videos, fonts) from the cache the
// page fills. Online, nothing changes: the page is still drawn on the server.
//
// The shared web server (packages/app/server/web-server.mjs) serves this file
// with BUILD and PRECACHE filled in for the running build, so each deploy is
// a new service worker. In development they stay placeholders and it does
// nothing.

const BUILD = "__SONGVERSE_BUILD__";
const PRECACHE = ["__SONGVERSE_PRECACHE__"];

const ENABLED = !BUILD.startsWith("__");
const CACHE = `oneverse-screen-app-${BUILD}`;
/** Filled by the page (screen-kept.ts), keyed by each file's address without its query. */
const FILES = "oneverse-screen-files";
/** The screen's page: only it works offline, not the operator's console. */
const PAGE = "/";
// A network that hangs counts as down after this long.
const NAVIGATION_TIMEOUT_MS = 5000;

self.addEventListener("install", (event) => {
  if (!ENABLED) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      // The page as this build draws it, so a reload right after the update still opens offline.
      await cache.add(PAGE).catch(() => undefined);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("oneverse-screen-app-") && key !== CACHE) await caches.delete(key);
      }
      // The first install takes the open page, so a drop works without a reload.
      await self.clients.claim();
    })(),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([fetch(request), timeout(NAVIGATION_TIMEOUT_MS)]);
    if (response.ok) {
      await cache.put(PAGE, response.clone());
      return response;
    }
    // The server itself down (a deploy, a crash): the page kept rather than an error.
    if (response.status < 500) return response;
  } catch {
    // Offline, or no answer in time.
  }
  return (await cache.match(PAGE)) ?? Response.error();
}

async function cached(request) {
  const hit = await caches.match(request, { cacheName: CACHE });
  if (hit) return hit;
  const response = await fetch(request);
  // Content-hashed, so a copy never goes stale.
  if (response.ok && new URL(request.url).pathname.startsWith("/assets/")) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

// A template file: the kept copy, else the network (a file not kept yet).
async function file(request, key) {
  const hit = await caches.match(key, { cacheName: FILES });
  return hit ?? fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!ENABLED || request.method !== "GET") return;
  const url = new URL(request.url);
  // The API's template files (screen-theme-assets.ts), at any origin.
  if (url.pathname.startsWith("/screen-themes/assets/")) {
    event.respondWith(file(request, url.origin + url.pathname));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    if (url.pathname === PAGE) event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) event.respondWith(cached(request));
});
