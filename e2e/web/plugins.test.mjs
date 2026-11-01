// Admin > Plugins and Find chords (issue #157), against the example Song
// provider server (examples/song-provider): an admin turns the Song
// provider plugin on and adds a server - a wrong key said, a right one
// kept and not shown again - tests it and chooses what it's asked for; a
// person adding a song finds its chords there, the chart and the details
// the form didn't have yet filled in, and where it came from said; the
// Editor's Replace from a file or paste… finds them too. Its versions
// (issue #369): best rated first, each its rating and where it comes from;
// Deezer has the song too, and taking a chart opens Auto detect's review of
// their details combined, the link saved with the song. Fits a phone.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { startFakeProviders } from "../lib/fake-providers.mjs";
import { FAKE_SONG_PROVIDER_KEY, startFakeSongProvider } from "../lib/fake-song-provider.mjs";

let page;
const step = stepper(() => page);
const port = Number(process.env.FAKE_SONG_PROVIDER_PORT ?? 3994);
const provider = await startFakeSongProvider({ port, apiKey: FAKE_SONG_PROVIDER_KEY, name: `Hymn server ${stamp}` });
const admin = await user("Plugins page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const writer = await user("Chord finder");
const plugin = async () => (await api(admin, "GET", "/admin/plugins")).plugins.find((one) => one.id === "song-provider");
for (const source of (await plugin()).sources) await api(admin, "DELETE", `/admin/plugins/song-provider/sources/${source.id}`);
await api(admin, "DELETE", "/admin/plugins/song-provider");
// Auto detect asks Deezer (a stand-in) and the song providers.
const services = await startFakeProviders();
await api(admin, "PUT", "/admin/metadata", { providers: [{ key: "song_providers" }, { key: "deezer" }] });

const browser = await chromium.launch();
const errors = [];
const open = async (who, viewport = { width: 1280, height: 900 }) => {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  await signIn(p, who);
  return p;
};

try {
  page = await open(admin);
  const card = () => page.getByTestId("plugin-song-provider");
  const form = () => card().getByTestId("song-provider-add");

  await step("Admin > Plugins: the Song provider plugin, off", async () => {
    await page.goto(`${WEB}/admin/plugins`);
    await page.waitForLoadState("networkidle");
    await card().getByText("Built in", { exact: true }).waitFor();
    if (await card().getByTestId("plugin-enabled").isChecked()) throw new Error("on by default");
    await card().getByText("No server added yet.").waitFor();
  });

  await step("turned on", async () => {
    await card().getByTestId("plugin-enabled").check();
    await card().getByText("Saved here", { exact: false }).first().waitFor();
    if ((await plugin()).enabled !== true) throw new Error("not saved");
  });

  await step("a server with a wrong key: not added, and said", async () => {
    await form().getByLabel("Address", { exact: true }).fill(provider.url);
    await form().getByLabel("Key", { exact: true }).fill("wrong-key");
    await form().getByLabel("On this network").check();
    await form().getByRole("button", { name: "Add" }).click();
    await form().getByRole("alert").getByText(/refused the key/).waitFor();
  });

  await step("the right key: added with its own name, the key not shown again", async () => {
    await form().getByLabel("Key", { exact: true }).fill(FAKE_SONG_PROVIDER_KEY);
    await form().getByRole("button", { name: "Add" }).click();
    const row = card().getByTestId("song-provider-source");
    await row.getByText(`Hymn server ${stamp}`).waitFor();
    await row.getByText("Key saved").waitFor();
    if ((await page.content()).includes(FAKE_SONG_PROVIDER_KEY)) throw new Error("the key is on the page");
    if ((await form().getByLabel("Address", { exact: true }).inputValue()) !== "") throw new Error("the form wasn't cleared");
  });

  await step("Test connection, and what it's asked for", async () => {
    const row = card().getByTestId("song-provider-source");
    await row.getByRole("button", { name: "Test connection" }).click();
    await row.getByTestId("song-provider-test").getByText(/answers: songInfo, artwork, artistPictures, chords/).waitFor();
    await row.getByLabel("Artists' pictures").uncheck();
    for (let i = 0; i < 20 && (await plugin()).sources[0].hooks.includes("artistPictures"); i++) await page.waitForTimeout(200);
    if ((await plugin()).sources[0].hooks.join() !== "songInfo,artwork,chords") throw new Error((await plugin()).sources[0].hooks.join());
  });

  await step("fits a phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await card().getByTestId("song-provider-source").waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`scrolls sideways by ${overflow}px`);
  });

  page = await open(writer);
  let songId;
  await step("a new song: Find chords, the chart and its details filled in", async () => {
    await page.goto(`${WEB}/library/new`);
    await page.waitForLoadState("networkidle");
    await page.fill("#song-title", "Amazing Grace");
    const find = page.getByTestId("find-chords");
    await find.getByText(`Look this song up at Hymn server ${stamp}.`).waitFor();
    await find.getByRole("button", { name: "Find chords" }).click();
    const results = find.getByTestId("find-chords-results");
    const song = results.getByTestId("find-chords-song");
    await song.getByText("Amazing Grace", { exact: true }).waitFor();
    await song.getByTestId("find-chords-services").getByText("Also at Deezer").waitFor();
    // The best rated first, alone until its versions are asked for.
    const versions = song.getByTestId("find-chords-version");
    await versions.first().getByText("Original", { exact: true }).waitFor();
    await versions.first().getByRole("img", { name: "Rated 4.7 out of 5 by 120" }).waitFor();
    await versions.first().getByText(`From Example Chords at Hymn server ${stamp}`, { exact: false }).waitFor();
    if ((await versions.count()) !== 1) throw new Error(`${await versions.count()} versions shown`);
    await song.getByRole("button", { name: "Show its versions (3 versions)" }).click();
    await versions.nth(1).getByText("Simplified", { exact: true }).waitFor();
    await versions.nth(1).getByText(`Key C · by Marie · From Chord Sharers at Hymn server ${stamp}`).waitFor();
    await versions.nth(2).getByText(`Key A · Capo 2 · From Hymn server ${stamp}`).waitFor();
    await versions.first().getByRole("button", { name: "Use this chart" }).click();
    await page.getByTestId("find-chords-source").getByText(`The chart below is from Example Chords, found at Hymn server ${stamp}.`, { exact: false }).waitFor();
    await page.getByTestId("find-chords-source").getByText("Public domain: free to use.", { exact: false }).waitFor();
    const chart = await page.locator("#song-content").inputValue();
    if (!chart.includes("[G]Amazing grace")) throw new Error(chart);
    await page.getByRole("button", { name: "Remove Example Choir" }).waitFor();
  });

  await step("Deezer's details and the provider's, combined, to review", async () => {
    await page.getByTestId("find-chords-review-hint").getByText("What Deezer say of it is in Auto detect, to review.").waitFor();
    const review = page.getByTestId("song-info-review");
    await review.getByText("What this match fills in").waitFor();
    await review.locator('[data-field="album"]').getByText("Hymns We Love").waitFor();
    await review.locator('[data-field="duration"]').getByText("4:05").waitFor();
    await review.getByRole("button", { name: "Use all" }).click();
    await page.getByText("The link is saved with the song", { exact: false }).waitFor();
  });

  await step("saved: the chart, its key, tempo and writer", async () => {
    await page.getByRole("button", { name: "Save song" }).first().click();
    await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
    songId = page.url().split("/library/")[1].split("?")[0];
    const song = await api(writer, "GET", `/song-versions/${songId}`);
    const { key, tempo, timeSignature } = song.documentJson.defaults;
    if (key !== "G" || tempo !== 72 || `${timeSignature?.numerator}/${timeSignature?.denominator}` !== "3/4") throw new Error(JSON.stringify(song.documentJson.defaults));
    const types = song.documentJson.sections.map((section) => section.type).join();
    if (types !== "verse,chorus") throw new Error(types);
    if (!song.contributors.some((c) => c.source === "John Newton")) throw new Error(JSON.stringify(song.contributors));
    if (song.album !== "Hymns We Love") throw new Error(`album ${song.album}`);
    const linked = sql(`select string_agg(type::text, ',' order by type) from "SongVersionIdentifier" where "songVersionId"='${songId}'`);
    if (!linked.includes("DEEZER")) throw new Error(`linked: ${linked}`);
  });

  await step("the Editor's Replace from a file or paste… finds chords too", async () => {
    await page.goto(`${WEB}/library/${songId}?tab=editor`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Replace from a file or paste…" }).click();
    const dialog = page.getByTestId("replace-chart");
    await dialog.getByTestId("find-chords").getByRole("button", { name: "Find chords" }).click();
    await dialog.getByTestId("find-chords-results").getByRole("button", { name: "Use this chart" }).click();
    await dialog.getByTestId("find-chords-source").waitFor();
    if (!(await dialog.locator("#song-content").inputValue()).includes("My chains are")) throw new Error("no chart");
  });

  await step("no Find chords once the plugin is off", async () => {
    await api(admin, "PUT", "/admin/plugins/song-provider", { enabled: false });
    await page.goto(`${WEB}/library/new`);
    await page.waitForLoadState("networkidle");
    await page.getByText("Drop a file here, or").waitFor();
    if (await page.getByTestId("find-chords").count()) throw new Error("still offered");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.slice(0, 3).join(" | "));
  });
} finally {
  for (const source of (await plugin()).sources) await api(admin, "DELETE", `/admin/plugins/song-provider/sources/${source.id}`);
  await api(admin, "DELETE", "/admin/plugins/song-provider");
  await api(admin, "DELETE", "/admin/metadata");
  await browser.close();
  await provider.close();
  await services.close();
}
finish();
