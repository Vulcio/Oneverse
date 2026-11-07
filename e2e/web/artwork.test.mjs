// Song images in the browser (issue #85): a song's artwork on the Library's
// cards, in the song list and on its page; choosing another among Apple
// Music's matches (a stand-in, lib/fake-providers.mjs), with their full
// names on hover, or uploading one's own, cropped (issue #88); removing it;
// the admin's artwork settings.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { API, WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { png, startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
let page;
const step = stepper(() => page);
const me = await user("Painter");
sql(`update "User" set "isGlobalAdmin"=true where id='${me.id}'`);
await api(me, "DELETE", "/admin/artwork");
const song = await api(me, "POST", "/song-versions", { title: `Canvas ${stamp}`, language: "en", artists: ["Painter"] });
for (let i = 0; i < 40 && !(await api(me, "GET", `/song-versions/${song.id}`)).imageUrl; i++) await new Promise((r) => setTimeout(r, 250));

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
/** Whether an image has loaded: waited for (up to 10s), as a new address takes a moment. */
const loaded = (locator) =>
  locator
    .evaluate((img) => (img.complete && img.naturalWidth > 0) || new Promise((resolve) => {
      img.addEventListener("load", () => resolve(true), { once: true });
      img.addEventListener("error", () => resolve(false), { once: true });
      setTimeout(() => resolve(img.complete && img.naturalWidth > 0), 10000);
    }))
    .catch(() => false);

await step("its artwork on the Library's card and in the song list", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("shelf-newest").getByTestId("song-card").filter({ hasText: `Canvas ${stamp}` });
  const image = card.getByTestId("song-image");
  await image.waitFor();
  if (!(await loaded(image))) throw new Error("the card's image didn't load");
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`Canvas ${stamp}`)}`);
  const small = page.getByRole("row").filter({ hasText: `Canvas ${stamp}` }).getByTestId("song-image");
  await small.waitFor();
  if (!(await loaded(small))) throw new Error("the list's image didn't load");
});

let before;
await step("on its page; another chosen among the matches", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  const artwork = page.getByTestId("artwork-card");
  const image = artwork.getByTestId("song-image");
  await image.waitFor();
  before = await image.getAttribute("src");
  await artwork.getByRole("button", { name: "Find artwork" }).click();
  const choices = page.getByTestId("artwork-candidates");
  await choices.getByRole("button").nth(2).waitFor();
  await choices.getByRole("button", { name: "Use the artwork of Album 2" }).hover();
  await page.getByTestId("artwork-tooltip").filter({ hasText: `Canvas ${stamp} · Painter · 2016` }).first().waitFor();
  await choices.getByRole("button", { name: "Use the artwork of Album 3" }).click();
  await choices.waitFor({ state: "detached" });
  await page.waitForFunction((was) => document.querySelector('[data-testid="artwork-card"] [data-testid="song-image"]')?.getAttribute("src") !== was, before);
  if (!(await loaded(artwork.getByTestId("song-image")))) throw new Error("the new image didn't load");
});

await step("an image of one's own, cropped to a square", async () => {
  const artwork = page.getByTestId("artwork-card");
  const was = await artwork.getByTestId("song-image").getAttribute("src");
  await artwork.getByTestId("artwork-upload").setInputFiles({ name: "mine.png", mimeType: "image/png", buffer: png(250, 200, 10) });
  const cropper = page.getByRole("dialog").filter({ hasText: "Crop the artwork" });
  await cropper.locator("[data-testid=artwork-cropper] img").waitFor();
  await cropper.getByRole("button", { name: "Use this image" }).click();
  await cropper.waitFor({ state: "detached" });
  await page.waitForFunction((before) => document.querySelector('[data-testid="artwork-card"] [data-testid="song-image"]')?.getAttribute("src") !== before, was);
  if (sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`) !== "upload") throw new Error("not kept as an upload");
});

await step("its album art by its title (issue #146): in Edit, and in Practice", async () => {
  await page.getByTestId("song-art").waitFor();
  if (!(await loaded(page.getByTestId("song-art")))) throw new Error("not shown in Edit");
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByTestId("practice-song").getByTestId("song-art").waitFor();
  if (!(await loaded(page.getByTestId("song-art")))) throw new Error("not shown in Practice");
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.goto(`${WEB}/library/${song.id}`);
});

await step("the lock screen shows it while the song plays (issue #173)", async () => {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", "DRUMS");
  form.append("file", new Blob([readFileSync(new URL("../fixtures/stems/03 drums.mp3", import.meta.url))], { type: "audio/mpeg" }), "03 drums.mp3");
  const res = await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  if (res.status !== 201) throw new Error(`upload: ${res.status}`);
  // The stem player is Practice's.
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await page.getByTestId("stem-player").getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => (navigator.mediaSession.metadata?.artwork.length ?? 0) > 0, null, { timeout: 15000 });
  const metadata = await page.evaluate(() => ({ title: navigator.mediaSession.metadata.title, artist: navigator.mediaSession.metadata.artist, artwork: navigator.mediaSession.metadata.artwork.map((image) => image.src) }));
  if (metadata.title !== `Canvas ${stamp}` || metadata.artist !== "Painter") throw new Error(JSON.stringify(metadata));
  if (!metadata.artwork.every((src) => src.includes(`/song-versions/${song.id}/image/`)) || !metadata.artwork.some((src) => src.endsWith("&w=512"))) throw new Error(JSON.stringify(metadata.artwork));
  await page.getByTestId("stem-player").getByRole("button", { name: "Pause", exact: true }).click();
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.goto(`${WEB}/library/${song.id}`);
});

await step("removed: the cover made from its title", async () => {
  const artwork = page.getByTestId("artwork-card");
  await artwork.getByRole("button", { name: "Remove" }).click();
  await artwork.getByTestId("song-cover").waitFor();
  await artwork.getByText("No artwork yet").waitFor();
});

await step("the admin's artwork settings", async () => {
  await page.goto(`${WEB}/admin/metadata`);
  const settings = page.getByTestId("artwork-settings");
  await settings.getByText("Currently using: the defaults").waitFor();
  await settings.getByLabel("Find artwork for songs").uncheck();
  await settings.getByLabel("Find artwork for songs").check();
  await settings.getByRole("button", { name: "Save configuration" }).click();
  await settings.getByText("Currently using: settings saved here.").waitFor();
  await settings.getByRole("button", { name: "Find artwork for songs without one" }).click();
  // A background job (issue #92): its result shows under Background jobs, refreshed on its own.
  await settings.getByText("Started in the background", { exact: false }).waitFor();
  const jobs = page.getByTestId("background-jobs");
  await jobs.getByText(/The Worker is running|runs background jobs itself/).first().waitFor();
  await jobs.getByTestId("jobs-recent").getByText(/Tried \d+ songs, found artwork for \d+\./).first().waitFor({ timeout: 90000 });
  await settings.getByRole("button", { name: "Revert to defaults" }).click();
  await settings.getByRole("button", { name: "Revert", exact: true }).click();
  await settings.getByText("Currently using: the defaults").waitFor();
});

await browser.close();
fake.close();
finish();
