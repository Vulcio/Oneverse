// The library's sections (issue #58): Songs (what Library opens on), with
// language, tag and artist filters; Artists; and smart lists - saved filters,
// each user's own, in the sidebar.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Curator");
const stranger = await user("Stranger");
const [tag] = await api(me, "GET", "/tags");
const anna = `Anna ${stamp}`;
const song = (title, artists, extra = {}) => api(me, "POST", "/song-versions", { title, language: "en", artists, ...extra });
await song(`Morning ${stamp}`, [anna], { tagIds: [tag.id] });
// The same artist, written differently: one artist.
await song(`Evening ${stamp}`, [`ÁNNA ${stamp}`]);
await song(`Noon ${stamp}`, [`Bob ${stamp}`], { language: "fr", tagIds: [tag.id] });

// --- the API
let r = await call(me, "GET", `/song-versions/artists?q=${stamp}`);
const byName = (name) => r.body.find((artist) => artist.name.toLowerCase() === name.toLowerCase());
check("artists with their song counts; case aside, one artist", r.status === 200 && r.body.length === 2 && byName(anna)?.songCount === 2 && byName(`Bob ${stamp}`)?.songCount === 1, JSON.stringify(r.body));
r = await call(me, "GET", `/song-versions/artists?q=${encodeURIComponent(`anna ${stamp}`)}`);
check("searched, ignoring accents", r.body.length === 1, JSON.stringify(r.body));
r = await call(stranger, "GET", `/song-versions/artists?q=${stamp}`);
check("only artists of songs you can see", r.status === 200 && r.body.length === 0);
r = await call(me, "GET", `/song-versions?artist=${encodeURIComponent(`anna ${stamp}`)}`);
check("an artist's songs, whatever the case and accents", r.body.total === 2, String(r.body.total));
r = await call(me, "GET", `/song-versions?artist=${encodeURIComponent(`Ann ${stamp}`)}`);
check("the whole name, not part of it", r.body.total === 0, String(r.body.total));

r = await call(me, "POST", "/smart-lists", { name: " French ", filters: { language: "fr", q: "", sort: "title" } });
check("a smart list keeps the filters that are set", r.status === 201 && r.body.name === "French" && Object.keys(r.body.filters).sort().join() === "language,sort" && r.body.filters.language === "fr" && r.body.filters.sort === "title", JSON.stringify(r.body));
const french = r.body;
r = await call(me, "PATCH", `/smart-lists/${french.id}`, { name: "In French" });
check("renamed, its filters kept", r.status === 200 && r.body.name === "In French" && r.body.filters.language === "fr");
r = await call(me, "POST", "/smart-lists", { name: "", filters: {} });
check("a list needs a name", r.status === 400, String(r.status));
r = await call(me, "POST", "/smart-lists", { name: "Bad", filters: { sort: "loudness" } });
check("and filters the library knows", r.status === 400, String(r.status));
r = await call(stranger, "PATCH", `/smart-lists/${french.id}`, { name: "Mine now" });
check("someone else's list can't be changed", r.status === 404, String(r.status));
r = await call(stranger, "GET", "/smart-lists");
check("nor seen", r.status === 200 && r.body.length === 0);
r = await call(me, "DELETE", `/smart-lists/${french.id}`);
check("deleted", r.status === 204 && (await api(me, "GET", "/smart-lists")).length === 0);

// --- the web app
const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
const sections = () => page.getByTestId("library-sections");
const rangeIs = (text) => page.waitForFunction((t) => document.querySelector('[data-testid="library-range"]')?.textContent === t, text);

await step("Songs and Artists are under Library in the sidebar", async () => {
  await page.goto(`${WEB}/library/songs`);
  await page.waitForLoadState("networkidle");
  await sections().getByRole("link", { name: "Songs", exact: true }).waitFor();
  await sections().getByRole("link", { name: "Artists", exact: true }).click();
  await page.waitForURL(`${WEB}/library/artists`);
  await page.getByRole("heading", { name: "Artists" }).waitFor();
});

await step("Artists: each with their songs; one opens their page (issue #86), and it their songs", async () => {
  await page.getByRole("searchbox").fill(stamp.toString());
  const row = page.getByTestId("artist-list").getByRole("link", { name: new RegExp(`^Anna ${stamp}`, "i") });
  await row.getByText("2 songs").waitFor();
  await page.getByTestId("artist-count").getByText("2 artists").waitFor();
  await row.click();
  await page.waitForURL(/\/library\/artists\/.+/);
  await page.getByTestId("artist-songs").getByRole("listitem").nth(1).waitFor();
  await page.getByTestId("artist-header").getByRole("link", { name: "2 songs" }).click();
  await page.waitForURL(/artist=/);
  await rangeIs("1–2 of 2");
  await page.getByTestId("artist-filter").getByText(/^By Anna/i).waitFor();
});

await step("filters: a tag narrows the artist's songs; saved as a smart list", async () => {
  await page.getByLabel("Tag").selectOption(tag.id);
  await rangeIs("1–1 of 1");
  await page.getByRole("button", { name: "Save as a smart list" }).click();
  await page.getByLabel("Name of the list").fill(`Anna tagged ${stamp}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/list=/);
  await page.getByRole("heading", { name: `Anna tagged ${stamp}` }).waitFor();
  await sections().getByRole("link", { name: `Anna tagged ${stamp}` }).waitFor();
  const [list] = await api(me, "GET", "/smart-lists");
  if (list.filters.tagId !== tag.id || list.filters.artist?.toLowerCase() !== anna.toLowerCase()) throw new Error(JSON.stringify(list.filters));
});

await step("a changed list can be saved again; the sidebar opens it with its filters", async () => {
  await page.getByTestId("artist-filter").getByRole("button", { name: "Show every artist" }).click();
  await page.getByRole("searchbox").fill(stamp.toString());
  // The search is applied a moment after typing stops (the range is 1–2 of 2 either way): saved once it's in the address.
  await page.waitForURL(new RegExp(`[?&]q=[^&]*${stamp}`));
  await page.waitForLoadState("networkidle");
  await rangeIs("1–2 of 2");
  // The bar can render again as the search settles, losing a click: clicked until the list has the change.
  const save = page.getByRole("button", { name: "Save changes to the list" });
  for (let attempt = 0; ; attempt++) {
    await save.click({ timeout: 5000 }).catch(() => {});
    const saved = await save.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
    if (saved) break;
    if (attempt === 3) throw new Error("the list wasn't saved");
  }
  await sections().getByRole("link", { name: "Songs", exact: true }).click();
  await page.waitForURL(`${WEB}/library/songs`);
  await page.getByRole("heading", { name: "Songs", exact: true }).waitFor();
  await sections().getByRole("link", { name: `Anna tagged ${stamp}` }).click();
  await page.getByRole("heading", { name: `Anna tagged ${stamp}` }).waitFor();
  await rangeIs("1–2 of 2");
  // The search box is filled from the list once it has loaded: waited for, not read once.
  await page
    .waitForFunction((want) => document.querySelector("input[type=search]")?.value === want, stamp.toString(), { timeout: 10000 })
    .catch(() => {
      throw new Error("the search wasn't restored");
    });
});

await step("renamed, then deleted", async () => {
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Name of the list").fill(`Tagged ${stamp}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await sections().getByRole("link", { name: `Tagged ${stamp}`, exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete list" }).click();
  await page.getByRole("button", { name: "Delete it" }).click();
  await page.getByRole("heading", { name: "Songs", exact: true }).waitFor();
  await sections().getByRole("link", { name: `Tagged ${stamp}`, exact: true }).waitFor({ state: "detached" });
});

await step("the language filter", async () => {
  await page.goto(`${WEB}/library/songs?q=${stamp}`);
  await page.waitForLoadState("networkidle");
  await rangeIs("1–3 of 3");
  await page.locator("select").filter({ hasText: "All languages" }).selectOption("fr");
  await rangeIs("1–1 of 1");
  await page.getByText(`Noon ${stamp}`).waitFor();
});

await browser.close();
finish();
