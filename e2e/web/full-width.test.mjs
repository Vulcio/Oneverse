// The whole width of the screen (issue #177): the page column fills the main
// area; a long chart flows into columns on a wide screen - Auto, or up to 2
// or 3, remembered on the device - a section never split between two, one
// column on a phone; Live the same; the editor's preview beside it.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user, displaySetting } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Wide");
// Each verse has its own words: identical ones would be one verse sung six times, all named "Verse" (issue #344).
const verse = (n) => `{start_of_verse: Verse ${n}}\n[G]Amazing grace ${n} how [C]sweet the sound\n[G]That saved a wretch like [D]me\n[G]I once was lost but [C]now am found\n[G]Was blind but [D]now I [G]see\n{end_of_verse}\n`;
const song = await api(me, "POST", "/song-versions", { title: `Wide ${stamp}`, language: "en", artists: ["Band"], content: [1, 2, 3, 4, 5, 6].map(verse).join(""), contentFormat: "CHORDPRO" });

/** Each pass's left edge and how many boxes it's drawn in (more than one: split between columns). */
const passes = () =>
  page.getByTestId("song-chart").first().evaluate((chart) =>
    [...chart.querySelectorAll(":scope > [data-pass]")].map((pass) => ({ left: Math.round(pass.getBoundingClientRect().left), boxes: pass.getClientRects().length })),
  );
const columnsOf = async () => new Set((await passes()).map((pass) => pass.left)).size;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 2560, height: 1300 } });
  await signIn(page, me);

  await step("the page column fills the main area, but for its gutter", async () => {
    await page.goto(`${WEB}/library/songs`);
    await page.getByRole("heading", { name: "Songs" }).waitFor();
    const gap = await page.evaluate(() => {
      const main = document.querySelector('[data-slot="sidebar-inset"]').getBoundingClientRect();
      const heading = document.querySelector("h1").getBoundingClientRect();
      return main.right - main.left - 2 * (heading.left - main.left);
    });
    // Its content spans the main area less its two gutters: no column of 1280px in the middle.
    if (gap < 1800) throw new Error(`the column is ${gap}px wide`);
  });

  await step("Practice: one column by default (issue #264); Auto flows it, no section split", async () => {
    await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("song-chart").waitFor();
    await page.locator('[data-testid="song-chart"][data-columns="1"]').waitFor();
    if ((await columnsOf()) !== 1) throw new Error(`${await columnsOf()} columns by default`);
    await displaySetting(page, "layout", "display-columns-auto");
    await page.locator('[data-testid="song-chart"][data-columns="auto"]').waitFor();
    const all = await passes();
    if ((await columnsOf()) < 2) throw new Error(`one column: ${JSON.stringify(all)}`);
    if (all.some((pass) => pass.boxes !== 1)) throw new Error(`a section split: ${JSON.stringify(all)}`);
  });

  await step("2 columns, kept for Practice; 1 puts it back in one", async () => {
    await displaySetting(page, "layout", "display-columns-2");
    await page.waitForFunction(() => document.querySelector('[data-testid="song-chart"]')?.dataset.columns === "2");
    if ((await columnsOf()) !== 2) throw new Error(`${await columnsOf()} columns`);
    await page.waitForTimeout(1000); // saved a moment after the change
    await page.reload();
    await page.locator('[data-testid="song-chart"][data-columns="2"]').waitFor();
    if ((await columnsOf()) !== 2) throw new Error("not remembered");
    await displaySetting(page, "layout", "display-columns-1");
    await page.waitForFunction(() => document.querySelector('[data-testid="song-chart"]')?.dataset.columns === "1");
    if ((await columnsOf()) !== 1) throw new Error(`${await columnsOf()} columns`);
    await displaySetting(page, "layout", "display-columns-auto");
  });

  await step("Live: one column by default too; Auto flows it", async () => {
    await page.goto(`${WEB}/library/${song.id}/live`);
    await page.getByTestId("song-chart").waitFor();
    await page.locator('[data-testid="song-chart"][data-columns="1"]').waitFor();
    await displaySetting(page, "layout", "display-columns-auto");
    await page.locator('[data-testid="song-chart"][data-columns="auto"]').waitFor();
    if ((await columnsOf()) < 2) throw new Error("one column in Live");
  });

  await step("on a phone: one column, whatever's chosen", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("song-chart").waitFor();
    if ((await columnsOf()) !== 1) throw new Error(`${await columnsOf()} columns on a phone`);
    await page.setViewportSize({ width: 2560, height: 1300 });
  });

  await step("the editor: its preview beside it with room, not on a laptop", async () => {
    await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await page.getByTestId("editor-side-preview").getByText("Verse 6", { exact: true }).waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId("editor-side-preview").waitFor({ state: "hidden" });
  });
} finally {
  await browser.close();
}
finish();
