// A songbook's song details in the browser (issue #353): edited in place,
// a cell saved when it's left; then the whole songbook looked up again,
// each song's changes reviewed and used in one pass.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
let page;
const step = stepper(() => page);
const me = await user("Book editor");
const songbook = await api(me, "POST", "/songbooks", { name: `Details ${stamp}`, kind: "NUMBERED", abbreviation: "DT" });
const song = await api(me, "POST", "/song-versions", { title: `Oceans ${stamp}`, language: "en", artists: ["Hillsong"] });
await api(me, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: song.id, entryCode: "3" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await signIn(page, me);

await step("a cell changed in the table is saved when it's left", async () => {
  await page.goto(`${WEB}/songbooks/${songbook.id}`);
  const card = page.getByTestId("songbook-song-info");
  await card.getByRole("button", { name: "Edit song details" }).click();
  const year = card.getByLabel(`Year - Oceans ${stamp}`);
  await year.fill("1999");
  await card.getByLabel(`Key - Oceans ${stamp}`).click();
  await card.getByTestId("song-info-row-state").getByText("Saved").waitFor();
  const saved = await api(me, "GET", `/song-versions/${song.id}`);
  if (saved.year !== 1999) throw new Error(`year ${saved.year}`);
});

await step("looked up again: what would change, the empty ones ticked", async () => {
  const panel = page.getByTestId("song-info-refresh");
  await panel.getByRole("button", { name: "Look the songs up" }).click();
  await panel.getByTestId("song-info-refresh-summary").getByText("1 of 1 songs would change", { exact: false }).waitFor({ timeout: 30000 });
  const row = (field) => panel.getByTestId("song-info-refresh-song").locator(`[data-field="${field}"]`);
  if (!(await row("album").getByRole("checkbox").isChecked())) throw new Error("the album isn't ticked");
  if (await row("year").getByRole("checkbox").isChecked()) throw new Error("the year it has is ticked");
  await row("tempo").getByRole("checkbox").uncheck();
});

await step("used: the ticked ones written, the rest left", async () => {
  const panel = page.getByTestId("song-info-refresh");
  await panel.getByRole("button", { name: /^Use \d+ changes?$/ }).click();
  await panel.getByText("1 song updated.").waitFor();
  const saved = await api(me, "GET", `/song-versions/${song.id}`);
  if (saved.album !== "Album 1" || saved.year !== 1999 || saved.documentJson.defaults.tempo) throw new Error(`${saved.album} ${saved.year} ${saved.documentJson.defaults.tempo}`);
  // The table shows it.
  if ((await page.getByTestId("songbook-song-info").getByLabel(`Album - Oceans ${stamp}`).inputValue()) !== "Album 1") throw new Error("the table wasn't reloaded");
});

await browser.close();
fake.close();
finish();
