// A songbook's songs as a table (issue #440): the Library's columns with
// the songbook's own (number, section), key and tempo; columns chosen on the
// device; a star, Add to set and "…" (Open, Remove) on each row.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Songbook songs");
const reader = await user("Songbook reader");
const book = await api(me, "POST", "/songbooks", { name: `Columns ${stamp}`, kind: "NUMBERED", abbreviation: "CO" });
await api(me, "PATCH", `/songbooks/${book.id}`, { sections: [{ label: "CO1", start: 1, end: 99 }] });
const oceans = await api(me, "POST", "/song-versions", { title: `Oceans ${stamp}`, language: "en", artists: ["Hillsong"], key: "D", tempo: 64, timeSignature: "4/4" });
const grace = await api(me, "POST", "/song-versions", { title: `Grace ${stamp}`, language: "en", artists: ["John Newton"] });
await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: oceans.id, entryCode: "12" });
const graceEntry = await api(me, "POST", `/songbooks/${book.id}/entries`, { songVersionId: grace.id, entryCode: "3" });
// Shared with one of the owner's people, to view.
await api(me, "POST", "/people/requests", { email: reader.email });
const request = (await api(reader, "GET", "/people")).incoming.find((i) => i.from.id === me.id);
await api(reader, "POST", `/people/requests/${request.id}/accept`);
await api(me, "PUT", `/songbooks/${book.id}/shares/users/${reader.id}`, { canEdit: false });

await step("the API lists its songs with key, tempo and star", async () => {
  await api(me, "PUT", `/song-versions/${oceans.id}/favorite`);
  const { songs } = await api(me, "GET", `/songbooks/${book.id}/songs`);
  const found = songs.find((song) => song.id === oceans.id);
  if (!found || found.key !== "D" || found.tempo !== 64 || found.timeSignature !== "4/4" || !found.isFavorite) throw new Error(JSON.stringify(found));
  if (found.artists[0]?.source !== "Hillsong") throw new Error(`artists ${JSON.stringify(found.artists)}`);
  const other = songs.find((song) => song.id === grace.id);
  if (!other || other.key !== null || other.tempo !== null || other.isFavorite) throw new Error(JSON.stringify(other));
  const stranger = await user("Songbook stranger");
  const { status } = await call(stranger, "GET", `/songbooks/${book.id}/songs`);
  if (status !== 403) throw new Error(`a stranger got ${status}`);
});

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await signIn(page, me);
const header = (name) => page.locator("thead th").filter({ hasText: new RegExp(`^${name}$`) });
const row = (title) => page.getByTestId("songbook-song-row").filter({ hasText: title });

await step("number, title, section, artist, key and tempo, in the book's order", async () => {
  await page.goto(`${WEB}/songbooks/${book.id}`);
  await row(`Oceans ${stamp}`).waitFor();
  const titles = await page.getByTestId("songbook-song-row").allInnerTexts();
  if (!titles[0].includes(`Grace ${stamp}`)) throw new Error(`order: ${titles.join(" | ")}`);
  const oceansRow = (await row(`Oceans ${stamp}`).innerText()).replace(/\s+/g, " ");
  for (const text of ["12", "CO1", "Hillsong", "D", "64"]) if (!oceansRow.includes(text)) throw new Error(`"${text}" missing from ${oceansRow}`);
  // The star shows as given.
  await row(`Oceans ${stamp}`).getByRole("button", { name: "Remove from favorites" }).waitFor();
});

await step("a column picked shows, and stays picked", async () => {
  await page.getByTestId("songbook-columns").click();
  const list = page.getByTestId("songbook-columns-list");
  await list.locator('[data-column="timeSignature"]').getByRole("checkbox").check();
  await list.locator('[data-column="key"]').getByRole("checkbox").uncheck();
  await page.keyboard.press("Escape");
  await header("Time").waitFor();
  if (await header("Key").count()) throw new Error("Key still shows");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await header("Time").waitFor();
});

await step("starred from the row", async () => {
  // The star turns at once; the server has it when its PUT answers.
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(`/song-versions/${grace.id}/favorite`) && response.ok());
  await row(`Grace ${stamp}`).getByRole("button", { name: "Add to favorites" }).click();
  await row(`Grace ${stamp}`).getByRole("button", { name: "Remove from favorites" }).waitFor();
  await saved;
  const { songs } = await api(me, "GET", `/songbooks/${book.id}/songs`);
  if (!songs.find((song) => song.id === grace.id)?.isFavorite) throw new Error("not starred");
});

await step("Add to set from the row lists the sets", async () => {
  await row(`Grace ${stamp}`).getByTestId("songbook-add-to-set").click();
  await page.getByTestId("add-to-set-list").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("add-to-set-list").waitFor({ state: "hidden" });
  if (!page.url().includes(`/songbooks/${book.id}`)) throw new Error("the click opened the song");
});

await step("Remove is in the row's … menu", async () => {
  if (await row(`Grace ${stamp}`).getByRole("button", { name: "Remove", exact: true }).count()) throw new Error("Remove shows on the row");
  await row(`Grace ${stamp}`).getByTestId("songbook-song-menu").click();
  await page.getByTestId("songbook-remove-song").click();
  await row(`Grace ${stamp}`).waitFor({ state: "detached" });
  const detail = await api(me, "GET", `/songbooks/${book.id}`);
  if (detail.entries.some((entry) => entry.id === graceEntry.id)) throw new Error("still in the songbook");
});

await step("clicking a row opens the song", async () => {
  await row(`Oceans ${stamp}`).locator("td").nth(2).click();
  await page.waitForURL(new RegExp(`/library/${oceans.id}`));
});

await step("on a phone: the key and the row's buttons fit, Add to set in …", async () => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, me);
  await phone.goto(`${WEB}/songbooks/${book.id}`);
  await phone.waitForLoadState("networkidle");
  const theirs = phone.getByTestId("songbook-song-row").filter({ hasText: `Oceans ${stamp}` });
  const menu = theirs.getByTestId("songbook-song-menu");
  const box = await menu.boundingBox();
  if (!box || box.x + box.width > 390 - 16) throw new Error(`the … button is off the screen: ${JSON.stringify(box)}`);
  // Real titles wrap; the table doesn't scroll sideways.
  const over = await phone.locator("table").evaluate((table) => table.parentElement.scrollWidth - table.parentElement.clientWidth);
  if (over > 0) throw new Error(`the table is ${over}px too wide`);
  await menu.click();
  await phone.getByRole("menuitem", { name: "Add to set" }).click();
  await phone.getByTestId("add-to-set-list").waitFor();
  await phone.close();
});

await step("someone who only views it has Open but no Remove", async () => {
  const other = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(other, reader);
  await other.goto(`${WEB}/songbooks/${book.id}`);
  const theirs = other.getByTestId("songbook-song-row").filter({ hasText: `Oceans ${stamp}` });
  await theirs.getByTestId("songbook-song-menu").click();
  await other.getByRole("menuitem", { name: "Open" }).waitFor();
  if (await other.getByTestId("songbook-remove-song").count()) throw new Error("a viewer can remove");
  await other.close();
});

await browser.close();
finish();
