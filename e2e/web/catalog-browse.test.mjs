// Reading a catalogue (issue #210): the list (the view remembered, and on a
// phone always), filters by tag, key and volume, an entry's details with its
// original song, its translations and its links as play buttons (YouTube in
// the dock, without leaving the page), Start and the mark on what's already
// a song in your songbooks.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stepper, tag, user } from "../lib/harness.mjs";
import { FAKE_YT } from "../lib/fake-youtube.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Browse admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reader = await user("Browse reader");
const abbr = `BR${tag}`;
const catalog = await api(admin, "POST", "/songbook-catalogs", { name: `Browse ${tag}`, abbreviation: abbr });
await api(admin, "PATCH", `/songbook-catalogs/${catalog.id}`, { sections: [{ label: `${abbr}1`, start: 1, end: 9 }, { label: `${abbr}2`, start: 10, end: 99 }] });
await api(admin, "POST", `/songbook-catalogs/${catalog.id}/entries/import`, {
  content: [
    "Number,Title,Artist,Composer,Key,Tags,Reference,YouTube,Spotify,OriginalSong",
    "1,Amazing Grace,Choir,John Newton,G,grace;hope,Ephesians 2:8,https://youtu.be/dQw4w9WgXcQ,https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC,",
    "2,Holy Holy Holy,Choir,John Dykes,Eb,praise,,,,",
    "12,Grâce infinie,Chorale,,G,grace,,,,1",
  ].join("\n"),
});
await api(reader, "POST", "/songbooks/import-from-catalog", { catalogId: catalog.id });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, reader);
await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 404, body: "" }));
const list = () => page.getByTestId("catalog-list");
const entry = (title) => list().getByTestId("catalog-list-entry").filter({ hasText: title });

await step("the list to read, filtered by tag, key and volume", async () => {
  await page.goto(`${WEB}/songbook-catalogs/${catalog.id}`);
  await page.waitForLoadState("networkidle");
  await entry("Amazing Grace").waitFor();
  if ((await list().getByTestId("catalog-list-entry").count()) !== 3) throw new Error("not every entry listed");
  await page.getByLabel("Tags", { exact: true }).selectOption("grace");
  await entry("Holy Holy Holy").waitFor({ state: "detached" });
  await page.getByLabel("Volume", { exact: true }).selectOption(`${abbr}2`);
  await entry("Amazing Grace").waitFor({ state: "detached" });
  await entry("Grâce infinie").waitFor();
  await page.getByLabel("Volume", { exact: true }).selectOption("");
  await page.getByLabel("Tags", { exact: true }).selectOption("");
  await page.getByLabel("Key", { exact: true }).selectOption("Eb");
  if ((await list().getByTestId("catalog-list-entry").count()) !== 1) throw new Error("the key filter");
  await page.getByLabel("Key", { exact: true }).selectOption("");
  await page.getByRole("searchbox", { name: "Search entries…" }).fill("ephesians");
  await entry("Amazing Grace").waitFor();
  if ((await list().getByTestId("catalog-list-entry").count()) !== 1) throw new Error("search across every field");
  await page.getByRole("searchbox", { name: "Search entries…" }).fill("");
});

await step("an entry's details: its credits, translation and links", async () => {
  await entry("Amazing Grace").getByRole("button").first().click();
  const details = page.getByTestId("catalog-entry-details");
  await details.getByText("Ephesians 2:8").waitFor();
  await details.getByText("John Newton").waitFor();
  await details.getByTestId("catalog-entry-translations").getByRole("link", { name: `${abbr} 12 · Grâce infinie` }).waitFor();
  const spotify = details.getByRole("link", { name: "Listen on Spotify" });
  if ((await spotify.getAttribute("href")) !== "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC") throw new Error("Spotify's address");
  // Nothing to change for a reader.
  if (await details.getByRole("button", { name: "Edit", exact: true }).count()) throw new Error("a reader can edit");
});

await step("Play on YouTube: in the dock, still on the catalogue", async () => {
  await page.getByTestId("catalog-entry-details").getByRole("button", { name: "Play on YouTube" }).click();
  await page.getByTestId("catalog-entry-details").waitFor({ state: "detached" });
  await page.locator('[data-testid="youtube-dock"][data-state="playing"]').waitFor();
  await page.locator('[data-testid="fake-youtube"][data-video="dQw4w9WgXcQ"]').waitFor();
  if (!page.url().includes(`/songbook-catalogs/${catalog.id}`)) throw new Error(`left for ${page.url()}`);
});

await step("Start: the song made, the entry marked with a link to it", async () => {
  await entry("Holy Holy Holy").getByRole("button", { name: "Start" }).click();
  await entry("Holy Holy Holy").getByTestId("catalog-in-library").waitFor();
  await entry("Holy Holy Holy").getByText(`In Browse ${tag}`).waitFor();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await entry("Holy Holy Holy").getByTestId("catalog-in-library").click();
  await page.waitForURL(/\/library\/(?!new)/);
  await page.getByText("Holy Holy Holy").first().waitFor();
});

await step("the table, chosen, is remembered; a phone shows the list", async () => {
  await page.goto(`${WEB}/songbook-catalogs/${catalog.id}`);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByTestId("catalog-entries").waitFor();
  await page.reload();
  await page.getByTestId("catalog-entries").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await list().waitFor();
  if (await page.getByTestId("catalog-entries").count()) throw new Error("the table on a phone");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`scrolls sideways by ${overflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "List", exact: true }).click();
});

await step("an admin edits an entry from its details", async () => {
  const adminPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page = adminPage;
  await signIn(adminPage, admin);
  await adminPage.goto(`${WEB}/songbook-catalogs/${catalog.id}`);
  await adminPage.waitForLoadState("networkidle");
  await entry("Holy Holy Holy").getByRole("button").first().click();
  const details = adminPage.getByTestId("catalog-entry-details");
  await details.getByRole("button", { name: "Edit", exact: true }).click();
  const links = details.getByTestId("catalog-entry-editor").getByLabel("Links");
  await links.fill("https://www.deezer.com/track/3135556");
  await links.blur();
  await details.getByRole("button", { name: "Done", exact: true }).click();
  await details.getByRole("link", { name: "Listen on Deezer" }).waitFor();
  const saved = (await api(admin, "GET", `/songbook-catalogs/${catalog.id}`)).entries.find((e) => e.entryCode === "2");
  if (saved.links.join() !== "https://www.deezer.com/track/3135556") throw new Error(JSON.stringify(saved.links));
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.slice(0, 2).join(" | "));
});

await browser.close();
finish();
