// Offline, step 3 (issue #51): the device keeps itself current. Upcoming
// sets are downloaded without being opened, changes are caught up, and sets
// that are deleted, no longer visible or past are removed.
import { offlineFingerprint } from "../../packages/core/dist/index.js";
import { API, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

// Playwright's offline mode doesn't reach a service worker's own requests;
// with this, routing does (see offline.test.mjs).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = await import("playwright");

let page;
const step = stepper(() => page);
const me = await user("Synced player");
const other = await user("Other owner");
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const song = await api(me, "POST", "/song-versions", { title: `Synced song ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Kept [C]current\n", contentFormat: "CHORDPRO" });
const makeSet = async (name, eventDate) => {
  const set = await api(me, "POST", "/setlists", { name, ...(eventDate && { eventDate }) });
  await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
  return set;
};
const soon = await makeSet(`Soon ${stamp}`, day(3));
const [soonItem] = (await api(me, "GET", `/setlists/${soon.id}`)).items;
const later = await makeSet(`Much later ${stamp}`, day(40));
const undated = await makeSet(`Undated ${stamp}`, null);
const past = await makeSet(`Past ${stamp}`, day(1));
const theirs = await api(other, "POST", "/setlists", { name: `Not mine ${stamp}`, eventDate: day(2) });

// --- the API
let r = await call(me, "POST", "/offline/sync", {});
const entry = (id) => r.body.sets.find((set) => set.id === id);
check(
  "sync lists the upcoming sets (yesterday to 14 days ahead) with their copies",
  r.status === 200 && r.body.upcoming.includes(soon.id) && r.body.upcoming.includes(past.id) && !r.body.upcoming.includes(later.id) && !r.body.upcoming.includes(undated.id) && !!entry(soon.id)?.copy?.songs.length,
  JSON.stringify(r.body.upcoming),
);
const version = entry(soon.id).version;
r = await call(me, "POST", "/offline/sync", { known: [{ id: soon.id, version }, { id: undated.id, version: "old" }, { id: theirs.id, version: "x" }, { id: "no-such-set", version: "x" }] });
check("an up-to-date set comes without its copy", !!entry(soon.id) && !entry(soon.id).copy && entry(soon.id).version === version);
check("a known set that's out of date comes with its copy, even undated", !!entry(undated.id)?.copy);
check("sets that can't be opened, or don't exist, are gone", r.body.gone.includes(theirs.id) && r.body.gone.includes("no-such-set") && !entry(theirs.id), JSON.stringify(r.body.gone));
await api(me, "PATCH", `/song-versions/${song.id}`, { title: `Renamed ${stamp}` });
r = await call(me, "POST", "/offline/sync", { known: [{ id: soon.id, version }] });
check("editing a song in the set changes the set's version", entry(soon.id).version !== version && entry(soon.id).copy?.songs[0].song.title === `Renamed ${stamp}`);
r = await call(me, "POST", "/offline/sync", { days: 61 });
check("days is 1 to 60", r.status === 400, String(r.status));

// --- asking only whether anything changed (issue #121)
r = await call(me, "POST", "/offline/sync", {});
const kept = {
  sets: r.body.sets.map(({ id, version }) => ({ id, version })),
  songs: r.body.songs.map(({ id, version, audio }) => ({ id, version, audio })),
  songbooks: r.body.songbooks.map(({ id, version }) => ({ id, version })),
};
let fingerprint = await offlineFingerprint(kept);
const asked = { fingerprint, known: kept.sets };
let res = await fetch(`${API}/offline/sync`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(asked) });
let text = await res.text();
let answer = JSON.parse(text);
check(
  "a device that keeps what it should: unchanged, in a few hundred bytes, with its pins and settings",
  answer.unchanged === true && text.length < 1000 && Array.isArray(answer.pins) && !!answer.viewer && !answer.songs,
  `${text.length} bytes: ${text.slice(0, 200)}`,
);
await api(me, "PATCH", `/song-versions/${song.id}`, { album: `Kept album ${stamp}` });
r = await call(me, "POST", "/offline/sync", asked);
check("after a change to one of its songs: changed, and it syncs its lists", r.body.unchanged === false && !r.body.songs, JSON.stringify(r.body));

// --- the device
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
const keptIds = () =>
  page.evaluate(async () => {
    const user = localStorage.getItem("songverse.offline.user");
    if (!user) return [];
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(`songverse-offline-${user}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains("sets")) return [];
    return new Promise((resolve) => {
      const req = db.transaction("sets").objectStore("sets").getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String).sort());
      req.onerror = () => resolve([]);
    });
  });
const waitForKept = async (want) => {
  const expected = [...want].sort();
  for (let i = 0; i < 75; i++) {
    if ((await keptIds()).join() === expected.join()) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`kept ${JSON.stringify(await keptIds())}, expected ${JSON.stringify(expected)}`);
};

await step("launching the app downloads the upcoming sets, without opening them", async () => {
  await signIn(page, me);
  // The service worker the sign-in's pages registered is active before the
  // next page opens: one opened while it activates is never claimed (as web/offline does).
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  await waitForKept([soon.id, past.id]);
});

await step("up to date, the next launch only asks whether anything changed (issue #121)", async () => {
  const syncs = [];
  const listen = (response) => {
    if (response.url().endsWith("/offline/sync")) syncs.push(response.request().postDataJSON() && response.json().then((body) => ({ sent: response.request().postDataJSON(), body })));
  };
  page.on("response", listen);
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  page.off("response", listen);
  const done = await Promise.all(syncs);
  if (done.length !== 1 || !done[0].sent.fingerprint || done[0].sent.knownSongs || done[0].body.unchanged !== true) {
    throw new Error(JSON.stringify(done.map(({ sent, body }) => ({ sent: Object.keys(sent), unchanged: body.unchanged }))));
  }
});

await step("offline, an upcoming set never opened plays in Live", async () => {
  await goOffline();
  await page.goto(`${WEB}/sets/${soon.id}`);
  await page.getByRole("heading", { name: `Soon ${stamp}` }).waitFor();
  await page.getByRole("link", { name: "Live", exact: true }).click();
  await page.getByRole("heading", { name: `Renamed ${stamp}` }).waitFor();
  await page.locator('[data-chord="C"]').first().waitFor();
  await goOnline();
});

await step("the next launch catches up: changes in, deleted and past sets out, opened ones kept", async () => {
  // An undated set opened online is kept, and stays.
  await page.goto(`${WEB}/sets/${undated.id}`);
  await page.waitForLoadState("networkidle");
  await waitForKept([soon.id, past.id, undated.id]);
  await api(me, "PATCH", `/song-versions/${song.id}`, { title: `Encore ${stamp}` });
  await api(me, "DELETE", `/setlists/${past.id}`);
  sql(`update "Setlist" set "eventDate"='${day(-3)}' where id='${undated.id}'`);
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  // The past set is gone (deleted); the formerly undated one, now three days past, dropped.
  await waitForKept([soon.id]);
  // The same sync stored the changed copy before dropping sets.
  await goOffline();
  await page.goto(`${WEB}/sets/${soon.id}/live/${soonItem.id}`);
  await page.getByRole("heading", { name: `Encore ${stamp}` }).waitFor();
  await page.goto(`${WEB}/sets/${past.id}`);
  await page.getByTestId("not-available-offline").waitFor();
  await goOnline();
});

await browser.close();
finish();
