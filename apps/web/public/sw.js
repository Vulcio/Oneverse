// Songverse's service worker (issue #49, docs/offline.md "The app itself").
//
// It keeps the app's code and an app shell - a page that boots the app in
// the browser without the server - so Songverse opens offline. Online,
// nothing changes: pages are still drawn on the server.
//
// server.mjs serves this file with BUILD and PRECACHE filled in for the
// running build, so each deploy is a new service worker: it installs in
// the background and takes over on the next launch (when every Songverse
// tab has closed), never in the middle of a performance. In development
// (Vite serving this file as is) they stay placeholders and it does nothing.

const BUILD = "__SONGVERSE_BUILD__";
const PRECACHE = ["__SONGVERSE_PRECACHE__"];

const ENABLED = !BUILD.startsWith("__");
const CACHE = `songverse-app-${BUILD}`;
const SHELL = "/_shell";
// A network that hangs (a venue's Wi-Fi) counts as down after this long.
const NAVIGATION_TIMEOUT_MS = 6000;

self.addEventListener("install", (event) => {
  if (!ENABLED) return;
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([SHELL, ...PRECACHE])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("songverse-app-") && key !== CACHE) await caches.delete(key);
      }
      // The first install takes the open page, so it works offline without a reload.
      await self.clients.claim();
    })(),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function page(request) {
  try {
    const response = await Promise.race([fetch(request), timeout(NAVIGATION_TIMEOUT_MS)]);
    // The server itself down (a deploy, a crash): the shell rather than an error page.
    if (response.status < 500) return response;
  } catch {
    // Offline, or no answer in time.
  }
  return (await caches.match(SHELL, { cacheName: CACHE })) ?? Response.error();
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

// Shared to Songverse from another app (issue #407, the manifest's
// `share_target`): what came is kept here for the Import page, which reads
// it and clears it - signed in first if it must.
const SHARED = "songverse-shared";

async function receiveShare(request) {
  try {
    const form = await request.formData();
    await caches.delete(SHARED);
    const cache = await caches.open(SHARED);
    const files = form.getAll("files").filter((value) => typeof value === "object" && value.size > 0);
    const kept = [];
    for (const [index, file] of files.entries()) {
      const key = `/shared/file/${index}`;
      await cache.put(key, new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream" } }));
      kept.push({ key, name: file.name, type: file.type });
    }
    const text = (name) => (typeof form.get(name) === "string" ? form.get(name) : "");
    await cache.put("/shared/meta", new Response(JSON.stringify({ title: text("title"), text: text("text"), url: text("url"), files: kept, at: Date.now() }), { headers: { "Content-Type": "application/json" } }));
  } catch {
    // Unreadable: the Import page says nothing came.
  }
  return Response.redirect("/import?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(receiveShare(request));
    return;
  }
  if (!ENABLED) return;
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) event.respondWith(cached(request));
});

// Notifications on this device (issue #236): the server's push, already in
// the reader's words - its title, a line and where tapping it leads.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not ours: shown plainly rather than dropped (browsers want every push shown).
  }
  const title = typeof message.title === "string" && message.title ? message.title : "Songverse";
  // The number on the app's icon (issue #407): the server's count of unread notifications.
  const badge =
    typeof message.unread === "number" && "setAppBadge" in self.navigator
      ? (message.unread > 0 ? self.navigator.setAppBadge(message.unread) : self.navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve();
  event.waitUntil(
    Promise.all([badge, self.registration.showNotification(title, {
      body: typeof message.body === "string" ? message.body : "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: typeof message.tag === "string" ? message.tag : undefined,
      data: { url: typeof message.url === "string" && message.url.startsWith("/") ? message.url : "/" },
    })]),
  );
});

// Tapped: the open Songverse tab goes there, else a new one opens.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = tabs.find((client) => new URL(client.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        return tab.navigate(url).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })(),
  );
});
