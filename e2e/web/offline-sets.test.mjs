// Offline, step 2 (issue #50): a set opened while online opens again with
// no network - its page, its songs, and Live - and catches up when it's
// opened online again. Search finds the songs of kept sets offline.
import { API, WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

// Playwright's offline mode doesn't reach a service worker's own requests;
// with this, routing does (see offline.test.mjs).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = await import("playwright");

let page;
const step = stepper(() => page);
const me = await user("Kept player");
const stranger = await user("Stranger");
const song = (title, content) => api(me, "POST", "/song-versions", { title, language: "en", artists: ["Someone"], key: "G", content, contentFormat: "CHORDPRO" });
const opener = await song(`Opener ${stamp}`, "{start_of_verse}\n[G]First [C]song of the [D]night\n{end_of_verse}\n");
const closer = await song(`Closer ${stamp}`, "{start_of_chorus}\n[Em]Last [C]one [G]tonight\n{end_of_chorus}\n");
const set = await api(me, "POST", "/setlists", { name: `Kept gig ${stamp}` });
await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: opener.id });
const [first, second] = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: closer.id })).items;
const other = await api(me, "POST", "/setlists", { name: `Never opened ${stamp}` });

let r = await call(me, "GET", `/setlists/${set.id}/offline`);
check(
  "the offline copy: the set, and each song's view with its document",
  r.status === 200 && r.body.set.id === set.id && r.body.songs.length === 2 && r.body.songs[1].song.document.sections.length === 1 && r.body.songs[0].nextTitle === `Closer ${stamp}`,
  JSON.stringify(r.body).slice(0, 200),
);
r = await call(stranger, "GET", `/setlists/${set.id}/offline`);
check("someone who can't open the set can't download it", r.status === 404, String(r.status));

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
// The kept copy of a set, straight from IndexedDB.
const kept = (id) =>
  page.evaluate(async (id) => {
    const user = localStorage.getItem("songverse.offline.user");
    if (!user) return null;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(`songverse-offline-${user}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains("sets")) return null;
    return new Promise((resolve) => {
      const req = db.transaction("sets").objectStore("sets").get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  }, id);

await step("online: opening a set keeps it on the device", async () => {
  await signIn(page, me);
  // The service worker the sign-in's pages registered is active before the
  // set opens: a page opened while it activates is never claimed (as web/offline does).
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  for (let i = 0; i < 50 && !(await kept(set.id)); i++) await page.waitForTimeout(200);
  const copy = await kept(set.id);
  if (!copy || copy.songs.length !== 2) throw new Error(`kept: ${JSON.stringify(copy)?.slice(0, 200)}`);
});

await step("offline: the set opens, read-only", async () => {
  await goOffline();
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.getByRole("heading", { name: `Kept gig ${stamp}` }).waitFor();
  await page.getByTestId("offline-banner").waitFor();
  await page.getByTestId("set-song-row").filter({ hasText: `Closer ${stamp}` }).waitFor();
  if (await page.getByText("Add songs").count()) throw new Error("editing offline");
});

await step("offline: a song of the set opens, with its chords", async () => {
  await page.getByTestId("set-song-row").getByRole("link", { name: `Opener ${stamp}` }).click();
  await page.waitForURL(`**/sets/${set.id}/songs/${first.id}`);
  await page.getByRole("heading", { name: `Opener ${stamp}` }).waitFor();
  await page.locator('[data-chord="C"]').first().waitFor();
});

await step("offline: the set plays in Live, song to song", async () => {
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.getByRole("link", { name: "Live", exact: true }).click();
  await page.waitForURL(`**/sets/${set.id}/live/${first.id}`);
  await page.getByTestId("live-view").waitFor();
  await page.locator('[data-chord="D"]').first().waitFor();
  await page.getByTestId("live-next").getByText(`Next: Closer ${stamp}`).waitFor();
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(`**/live/${second.id}`);
  await page.getByRole("heading", { name: `Closer ${stamp}` }).waitFor();
  await page.locator('[data-chord="Em"]').first().waitFor();
});

await step("offline: search finds a kept song and plays it on its own", async () => {
  await page.getByTestId("command-search").click();
  await page.getByRole("combobox").fill(`opener ${stamp}`);
  await page.getByRole("group", { name: "Songs", exact: true }).getByRole("option", { name: new RegExp(`Opener ${stamp}`) }).click();
  await page.waitForURL(`**/library/${opener.id}/live?**`);
  await page.getByRole("heading", { name: `Opener ${stamp}` }).waitFor();
  await page.locator('[data-chord="G"]').first().waitFor();
});

await step("offline: a set never opened here isn't available", async () => {
  await page.goto(`${WEB}/sets/${other.id}`);
  await page.getByTestId("not-available-offline").waitFor();
});

await step("back online, opening the set catches its copy up", async () => {
  await goOnline();
  await api(me, "PATCH", `/song-versions/${closer.id}`, { title: `Encore ${stamp}` });
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 50 && (await kept(set.id))?.songs[1].song.title !== `Encore ${stamp}`; i++) await page.waitForTimeout(200);
  await goOffline();
  await page.goto(`${WEB}/sets/${set.id}/live/${second.id}`);
  await page.getByRole("heading", { name: `Encore ${stamp}` }).waitFor();
  await goOnline();
});

await browser.close();
finish();
