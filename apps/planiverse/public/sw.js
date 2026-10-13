// Planiverse's service worker (issue #241): notifications on this device
// only - Planiverse isn't kept for offline use the way Songverse is.

// The server's push, already in the reader's words: its title, a line and where tapping it leads.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not ours: shown plainly rather than dropped (browsers want every push shown).
  }
  const title = typeof message.title === "string" && message.title ? message.title : "Planiverse";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === "string" ? message.body : "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: typeof message.tag === "string" ? message.tag : undefined,
      data: { url: typeof message.url === "string" && message.url.startsWith("/") ? message.url : "/" },
    }),
  );
});

// Tapped: the open Planiverse tab goes there, else a new one opens.
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
