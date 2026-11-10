// One way to find a song (issue #424): a set's Add songs and a songbook's "add a song" find
// what the header search finds - by a number in a songbook too - and work from the keyboard.
import { chromium } from "playwright";
import { api, finish, signIn, stamp, stepper, tag, user, WEB } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const me = await user("Picker");
const abbr = `P${stamp.toString(36).slice(-4).toUpperCase()}`;
const hymnal = await api(me, "POST", "/songbooks", { name: `Hymnal ${tag}`, kind: "NUMBERED", abbreviation: abbr });
const plain = await api(me, "POST", "/songbooks", { name: `Plain ${tag}`, kind: "SIMPLE" });
const numbered = await api(me, "POST", "/song-versions", { artists: ["Test Artist"], title: `Numbered ${tag}`, language: "en" });
await api(me, "POST", "/song-versions", { artists: ["Test Artist"], title: `Other ${tag}`, language: "en" });
await api(me, "POST", `/songbooks/${hymnal.id}/entries`, { songVersionId: numbered.id, entryCode: "317" });
const set = await api(me, "POST", "/setlists", { name: `Picker set ${tag}` });

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

await step("a songbook's add a song finds a song by its number in another songbook, and Enter picks it", async () => {
  await signIn(page, me);
  await page.goto(`${WEB}/songbooks/${plain.id}`);
  const field = page.locator("#entry-search");
  await field.fill(`${abbr} 317`);
  const row = page.getByTestId("songbook-add-song").filter({ hasText: `Numbered ${tag}` });
  await row.waitFor();
  if (!(await row.innerText()).includes(`${abbr} 317`)) throw new Error(`the row doesn't show the number: ${await row.innerText()}`);
  // The first result is the one the keys act on.
  await page.waitForFunction(() => document.querySelector('[data-testid="songbook-add-song"]')?.getAttribute("aria-selected") === "true");
  await field.press("Enter");
  await page.waitForFunction((title) => document.querySelector("#entry-search")?.value === title, `Numbered ${tag}`);
  if (await page.getByTestId("songbook-add-song").count()) throw new Error("the results stay open once a song is picked");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // In the book: its entry, and the field empty again.
  await page.getByRole("link", { name: `Numbered ${tag}` }).first().waitFor();
  await page.waitForFunction(() => document.querySelector("#entry-search")?.value === "");
});

await step("a song already in the book isn't offered again; the arrows move", async () => {
  await page.locator("#entry-search").fill(tag);
  const rows = page.getByTestId("songbook-add-song");
  await rows.filter({ hasText: `Other ${tag}` }).waitFor();
  if (await rows.filter({ hasText: `Numbered ${tag}` }).count()) throw new Error("a song in the book is offered again");
});

await step("a set's Add songs: the arrows and Enter add a song", async () => {
  await page.goto(`${WEB}/sets/${set.id}`);
  const field = page.getByPlaceholder("Search by title, artist, number or CCLI…");
  await field.fill(tag);
  const rows = page.getByTestId("set-song-results").getByRole("option");
  await rows.filter({ hasText: `Other ${tag}` }).waitFor();
  await rows.filter({ hasText: `Numbered ${tag}` }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="set-song-results"] [role="option"]')?.getAttribute("aria-selected") === "true");
  const second = await rows.nth(1).innerText();
  await field.press("ArrowDown");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="set-song-results"] [role="option"]')[1]?.getAttribute("aria-selected") === "true");
  await field.press("Enter");
  const wanted = second.includes(`Other ${tag}`) ? `Other ${tag}` : `Numbered ${tag}`;
  await page.getByTestId("set-song-row").filter({ hasText: wanted }).waitFor();
  if ((await page.getByTestId("set-song-row").count()) !== 1) throw new Error("more than the song picked was added");
});

await browser.close();
finish();
