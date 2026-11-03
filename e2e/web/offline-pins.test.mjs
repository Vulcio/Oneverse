// Offline, step 4 (issue #52): own songs, pins ("Available offline", "Keep a
// local copy") and their files kept on the device through the same sync;
// songs and songbooks open offline; the storage page shows and frees them.
import { API, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

// Playwright's offline mode doesn't reach a service worker's own requests;
// with this, routing does (see offline.test.mjs).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = await import("playwright");

let page;
const step = stepper(() => page);
const me = await user("Pinner");
const stranger = await user("Stranger");
const song = (who, title, content = "[G]Hello [C]world\n") => api(who, "POST", "/song-versions", { title, language: "en", artists: [`Artist ${stamp}`], content, contentFormat: "CHORDPRO" });
const upload = async (songId, name, type, bytes, mime) => {
  const form = new FormData();
  form.append("type", type);
  form.append("file", new Blob([bytes], { type: mime }), name);
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${await res.text()}`);
  return res.json();
};

const mine = await song(me, `Mine ${stamp}`, "{start_of_verse}\n[D]My own [A]song\n{end_of_verse}\n");
const pdf = await upload(mine.id, "lead-sheet.pdf", "PDF", "%PDF-1.4 kept offline", "application/pdf");
const audio = await upload(mine.id, "demo.mp3", "AUDIO", "ID3 not really audio", "audio/mpeg");
// A global song: not mine, so only kept when pinned or in a kept songbook.
const pinned = await song(me, `Pinned ${stamp}`, "[Em]Pinned [C]song\n");
const inBook = await song(me, `In the book ${stamp}`, "[F]Songbook [C]song\n");
sql(`update "SongVersion" set "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED' where id in ('${pinned.id}', '${inBook.id}')`);
const book = await api(me, "POST", "/songbooks", { name: `Offline hymns ${stamp}`, kind: "NUMBERED" });
await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: inBook.id, entryCode: "42" });
const strangers = await song(stranger, `Private ${stamp}`);

// --- the API
let r = await call(me, "PUT", "/offline/pins", { kind: "SONG", targetId: strangers.id });
check("a song you can't open can't be pinned", r.status === 403 || r.status === 404, String(r.status));
r = await call(me, "PUT", "/offline/pins", { kind: "SONG", targetId: pinned.id });
check("pin a song", r.status === 200 && r.body.kind === "SONG" && r.body.includeAudio === false, JSON.stringify(r.body));
r = await call(me, "PUT", "/offline/pins", { kind: "SONGBOOK", targetId: book.id });
check("keep a local copy of a songbook", r.status === 200);
r = await call(me, "PUT", "/offline/pins", { kind: "SONG", targetId: mine.id, includeAudio: true });
check("ask for a song's audio", r.status === 200 && r.body.includeAudio === true);
r = await call(me, "GET", "/offline/pins");
check("the pins are listed", r.status === 200 && r.body.length === 3, JSON.stringify(r.body));

r = await call(me, "POST", "/offline/sync", {});
const songEntry = (id) => r.body.songs.find((s) => s.id === id);
check(
  "sync: own, pinned and songbook songs, with copies and files",
  !!songEntry(mine.id)?.copy && !!songEntry(pinned.id)?.copy && !!songEntry(inBook.id)?.copy && !songEntry(strangers.id) && songEntry(mine.id).copy.attachments.length === 2,
  JSON.stringify(r.body.songs.map((s) => s.id)),
);
check("audio only where asked for", songEntry(mine.id).audio === true && songEntry(pinned.id).audio === false);
check("sync: the kept songbook, with its entries", r.body.songbooks[0]?.id === book.id && r.body.songbooks[0].copy.songbook.entries.length === 1);
const knownSongs = r.body.songs.map(({ id, version }) => ({ id, version }));
const knownSongbooks = r.body.songbooks.map(({ id, version }) => ({ id, version }));
await call(me, "DELETE", `/offline/pins/SONG/${pinned.id}`);
await call(me, "DELETE", `/offline/pins/SONGBOOK/${book.id}`);
r = await call(me, "POST", "/offline/sync", { knownSongs, knownSongbooks });
check(
  "unpinned: gone, and the songbook's songs with it; the rest unchanged, without copies",
  r.body.goneSongs.includes(pinned.id) && r.body.goneSongs.includes(inBook.id) && r.body.goneSongbooks.includes(book.id) && !songEntry(mine.id)?.copy,
  JSON.stringify({ goneSongs: r.body.goneSongs, goneSongbooks: r.body.goneSongbooks }),
);
r = await call(me, "POST", "/offline/songs", { ids: [mine.id, strangers.id] });
check("a batch of songs leaves out what you can't open", r.status === 200 && r.body.length === 1 && r.body[0].song.id === mine.id);
r = await call(me, "GET", `/offline/songbooks/${book.id}`);
check("a songbook's offline copy", r.status === 200 && r.body.songbook.id === book.id && !!r.body.version);
r = await call(me, "DELETE", "/offline/pins/NOPE/x");
check("only sets, songs and songbooks are pinned", r.status === 400, String(r.status));
await call(me, "DELETE", `/offline/pins/SONG/${mine.id}`);

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
const keys = (store) =>
  page.evaluate(async (store) => {
    const user = localStorage.getItem("songverse.offline.user");
    if (!user) return [];
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(`songverse-offline-${user}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains(store)) return [];
    return new Promise((resolve) => {
      const req = db.transaction(store).objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String).sort());
      req.onerror = () => resolve([]);
    });
  }, store);
const waitFor = async (store, predicate, what) => {
  for (let i = 0; i < 75; i++) {
    if (predicate(await keys(store))) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${what}: ${store} has ${JSON.stringify(await keys(store))}`);
};

await step("launching keeps your own songs and their files - not the audio", async () => {
  await signIn(page, me);
  // The service worker the sign-in's pages registered is active before the
  // next page opens: one opened while it activates is never claimed (as web/offline).
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  await waitFor("songs", (k) => k.includes(mine.id), "own song");
  await waitFor("files", (k) => k.includes(pdf.id), "its PDF");
  if ((await keys("files")).includes(audio.id)) throw new Error("the audio came without being asked for");
});

await step("Available offline on a song keeps it; Keep a local copy on a songbook keeps it and its songs", async () => {
  await page.goto(`${WEB}/library/${pinned.id}`);
  await page.waitForLoadState("networkidle");
  const pin = page.getByTestId("offline-pin");
  await pin.getByText("Available offline").waitFor();
  await pin.click();
  await page.locator('[data-testid="offline-pin"][aria-pressed="true"]').waitFor();
  await waitFor("songs", (k) => k.includes(pinned.id), "pinned song");
  await page.goto(`${WEB}/songbooks/${book.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("offline-pin").getByText("Keep a local copy").click();
  await page.locator('[data-testid="offline-pin"][aria-pressed="true"]').waitFor();
  await waitFor("songbooks", (k) => k.includes(book.id), "songbook");
  await waitFor("songs", (k) => k.includes(inBook.id), "songbook's song");
});

await step("Include audio downloads a song's audio", async () => {
  await page.goto(`${WEB}/library/${mine.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("offline-pin").click();
  await page.locator('[data-testid="offline-pin"][aria-pressed="true"]').waitFor();
  await page.getByLabel("Include audio").check();
  await waitFor("files", (k) => k.includes(audio.id), "the audio");
});

await step("offline: songs open read-only with their files; the songbook opens; search finds them", async () => {
  await goOffline();
  await page.goto(`${WEB}/library/${mine.id}`);
  await page.getByTestId("offline-song").waitFor();
  await page.getByRole("heading", { name: `Mine ${stamp}` }).waitFor();
  await page.locator('[data-chord="D"]').first().waitFor();
  const file = page.getByTestId("offline-file").filter({ hasText: "lead-sheet.pdf" });
  await file.getByRole("button", { name: "Open" }).waitFor();
  // What it opens, and its bytes: the PDF as uploaded, from the device.
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => (window.__opened.push(String(url)), null);
  });
  await file.getByRole("button", { name: "Open" }).click();
  await page.waitForFunction(() => window.__opened.length > 0);
  const content = await page.evaluate(async () => (await fetch(window.__opened[0])).text());
  if (content !== "%PDF-1.4 kept offline") throw new Error(`opened ${JSON.stringify(content)}`);
  await page.goto(`${WEB}/songbooks/${book.id}`);
  await page.getByRole("heading", { name: `Offline hymns ${stamp}` }).waitFor();
  await page.getByText(`In the book ${stamp}`).first().waitFor();
  await page.getByTestId("command-search").click();
  await page.getByRole("combobox").fill(`Artist ${stamp}`);
  const songs = page.getByRole("group", { name: "Songs", exact: true });
  await songs.getByRole("option", { name: new RegExp(`Pinned ${stamp}`) }).waitFor();
  await songs.getByRole("option", { name: new RegExp(`In the book ${stamp}`) }).waitFor();
  // By its number, in the kept songbook.
  await page.getByRole("combobox").fill(`hymns ${stamp} 42`);
  await page.getByRole("group", { name: "In songbooks", exact: true }).getByRole("option", { name: new RegExp(`42 — In the book ${stamp}`) }).waitFor();
  await page.keyboard.press("Escape");
  await goOnline();
});

await step("the storage page shows what's kept and frees it", async () => {
  await goOnline();
  await page.goto(`${WEB}/offline`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Offline storage" }).waitFor();
  await page.getByText(/Last caught up/).waitFor();
  const books = page.getByTestId("offline-songbooks");
  await books.getByText(`Offline hymns ${stamp}`).waitFor();
  await page.getByTestId("offline-songs").getByText(`Pinned ${stamp}`).waitFor();
  await books.getByRole("button", { name: "Remove" }).click();
  await books.waitFor({ state: "detached" });
  // Removed on every device: unpinned on the server, and gone here after the sync.
  const pins = await api(me, "GET", "/offline/pins");
  if (pins.some((pin) => pin.kind === "SONGBOOK")) throw new Error("still pinned");
  await waitFor("songs", (k) => !k.includes(inBook.id), "the songbook's song removed");
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByText(/Last caught up/).waitFor();
});

await browser.close();
finish();
