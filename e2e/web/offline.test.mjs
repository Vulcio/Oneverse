// Offline, step 1 (issue #49): after one online visit, Songverse opens with
// no network - signed in, read-only, with its sidebar and an offline banner -
// a page it has nothing for says so, and signing out deletes what was kept.
import { ONEVERSE, WEB, api, finish, sidebarEntry, signIn, stamp, stepper, user } from "../lib/harness.mjs";

// Playwright's offline mode doesn't reach a service worker's own requests;
// with this, routing does, so "offline" below cuts the service worker off too.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = await import("playwright");

let page;
const step = stepper(() => page);
const me = await user("Offline player");
const set = await api(me, "POST", "/setlists", { name: `Offline gig ${stamp}` });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await context.newPage();
const goOffline = async () => {
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
};
const goOnline = async () => {
  await context.unroute("**/*");
  await context.setOffline(false);
};
const offlineDatabases = () => page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).filter((name) => name?.startsWith("songverse-offline-")));

await step("online: the service worker installs and takes the page", async () => {
  await signIn(page, me);
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  // Everything the app needs is kept before it counts as installed.
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((key) => key.startsWith("songverse-app-")));
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  if (!cached.includes("/_shell") || !cached.some((path) => path.startsWith("/assets/"))) throw new Error(cached.join(", "));
  if ((await offlineDatabases()).length !== 1) throw new Error("the session wasn't kept");
  if (await page.getByTestId("offline-banner").count()) throw new Error("an offline banner while online");
});

await step("offline: the app opens, signed in, with its sidebar and the banner", async () => {
  await goOffline();
  await page.goto(`${WEB}/dashboard`);
  await page.getByTestId("offline-banner").waitFor();
  await page.getByText("You're offline.").waitFor();
  // Whose it is (the account menu, on the sidebar's rail), still on the dashboard.
  await page.locator('[data-slot="sidebar-footer"]').getByRole("button", { name: "Offline player" }).waitFor();
  if (new URL(page.url()).pathname !== "/dashboard") throw new Error(`sent to ${page.url()}`);
  // The sidebar's sets, from the kept lists.
  await (await sidebarEntry(page, "Sets", `Offline gig ${stamp}`)).waitFor();
});

await step("offline: a page with nothing kept says so, never sign-in", async () => {
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByTestId("not-available-offline").waitFor();
  await page.getByRole("heading", { name: "Not available offline" }).waitFor();
  await page.getByTestId("offline-banner").waitFor();
  // Opened straight from the address bar too.
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.getByTestId("not-available-offline").waitFor();
  // The sign-in page sends a kept session into the app.
  await page.goto(`${WEB}/`);
  await page.waitForURL("**/library");
});

await step("back online: the banner goes, pages load again", async () => {
  await goOnline();
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.getByRole("heading", { name: `Offline gig ${stamp}` }).waitFor();
  if (await page.getByTestId("offline-banner").count()) throw new Error("still says offline");
});

await step("signing out deletes what was kept", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Offline player" }).first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // Out of Songverse and Oneverse (issue #303); then a page of Songverse's own that's there signed out.
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.goto(`${WEB}/invite/none`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(async () => !(await indexedDB.databases()).some((db) => db.name?.startsWith("songverse-offline-")));
  await goOffline();
  await page.goto(`${WEB}/dashboard`);
  await page.getByTestId("not-available-offline").waitFor();
  if (await page.getByText(`Offline gig ${stamp}`).count()) throw new Error("the kept sidebar is still there after signing out");
  await goOnline();
});

await browser.close();
finish();
