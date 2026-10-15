// The Display panel (issue #209): a small drawer at the bottom that leaves
// the page usable behind it; each change shows on the chart at once and is
// kept for the mode it was made in (Edit, Practice, Live), on the account.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Display tweaker");
const song = await api(me, "POST", "/song-versions", {
  title: `Display ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  content:
    "{start_of_verse}\n[G]Amazing [C]grace how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});

const browser = await chromium.launch();
// A phone: the panel covers only the bottom of the screen.
page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
const chart = () => page.getByTestId("song-chart");
const panel = () => page.getByTestId("display-panel");
const savedSettings = async (check) => {
  for (let i = 0; i < 30; i++) {
    const found = (await api(me, "GET", "/users/me")).displaySettings ?? {};
    if (check(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`not saved: ${JSON.stringify((await api(me, "GET", "/users/me")).displaySettings)}`);
};

await step("Practice: the panel opens over the bottom of the screen, the page still usable behind it", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await chart().waitFor();
  await page.getByTestId("display-open").click();
  await panel().waitFor();
  await page.getByTestId("display-mode").getByText("For Practice mode").waitFor();
  const box = await panel().boundingBox();
  if (!box || box.height > 844 * 0.4) throw new Error(`the panel is ${box?.height}px tall`);
  if (Math.round(box.y + box.height) < 840) throw new Error(`not at the bottom: ${JSON.stringify(box)}`);
  // No backdrop: the page behind takes taps.
  if ((await page.locator('[data-slot="drawer-backdrop"]').count()) > 0) throw new Error("a backdrop");
  await page.getByRole("heading", { name: `Display ${stamp}` }).click();
  await panel().waitFor();
});

await step("Text: font, spacing and size change the chart at once", async () => {
  if ((await chart().getAttribute("data-font")) !== "mono") throw new Error("not monospace by default");
  await panel().getByTestId("display-font-sans").click();
  await page.locator('[data-testid="song-chart"][data-font="sans"]').waitFor();
  await panel().getByTestId("display-spacing-relaxed").click();
  await page.locator('[data-testid="song-chart"][data-spacing="relaxed"]').waitFor();
  await panel().getByTestId("display-size").getByText("100%").waitFor();
  await panel().getByTestId("display-bigger").click();
  await panel().getByTestId("display-size").getByText("125%").waitFor();
  const zoom = await chart().evaluate((el) => el.closest("[style*=zoom]")?.style.zoom);
  if (zoom !== "1.25") throw new Error(`zoom ${zoom}`);
});

await step("Text: the chords' size apart from the lyrics', the chords still over their letters", async () => {
  const link = () => panel().getByTestId("display-link-sizes");
  const scale = async (expected) => {
    await page.locator(`[data-testid="song-chart"][data-chord-scale="${expected}"]`).waitFor();
    // The chord's own lettering against its line's.
    const ratio = await chart()
      .locator("[data-chord]:not([data-chord=''])")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.parentElement).fontSize));
    if (Math.abs(ratio - expected) > 0.01) throw new Error(`chords at ${ratio}, not ${expected}`);
  };
  // Linked by default: the chords follow the lyrics.
  await panel().getByTestId("display-chords-size").getByText("125%").waitFor();
  if ((await link().getAttribute("aria-pressed")) !== "true") throw new Error("not linked by default");
  await panel().getByTestId("display-chords-bigger").click();
  await panel().getByTestId("display-chords-size").getByText("150%").waitFor();
  if ((await link().getAttribute("aria-pressed")) !== "false") throw new Error("still linked");
  await scale(1.2);
  // Set apart: smaller lyrics leave the chords as they are.
  await panel().getByTestId("display-smaller").click();
  await panel().getByTestId("display-size").getByText("100%").waitFor();
  await panel().getByTestId("display-chords-size").getByText("150%").waitFor();
  await scale(1.5);
  await savedSettings((found) => found.PRACTICE?.chordSize === 1.5 && found.PRACTICE?.textSize === 1);
  await panel().getByTestId("display-bigger").click();
  // Linked again: the lyrics' size.
  await link().click();
  await panel().getByTestId("display-chords-size").getByText("125%").waitFor();
  await scale(1);
  await savedSettings((found) => found.PRACTICE?.textSize === 1.25 && found.PRACTICE?.chordSize === undefined);
});

await step("Chords: names, colours and lyrics only, from the section list", async () => {
  await panel().getByTestId("display-section").click();
  await page.getByTestId("display-section-chords").click();
  await panel().getByTestId("display-notation-NASHVILLE").click();
  await chart().locator("[data-chord]").first().getByText("1").waitFor();
  await panel().getByTestId("display-color-family").click();
  await chart().locator("[data-family]").first().waitFor();
  await panel().getByTestId("display-chords-hidden").click();
  await page.locator('[data-testid="song-chart"][data-hide-chords]').waitFor();
  if ((await chart().locator("[data-chord]").count()) !== 0) throw new Error("chords still shown");
  await panel().getByTestId("display-chords-shown").click();
  await chart().locator("[data-chord]").first().waitFor();
});

await step("Instrument: guitar diagrams and a tuning (the account's, for every mode)", async () => {
  await panel().getByTestId("display-section").click();
  await page.getByTestId("display-section-instrument").click();
  await panel().getByTestId("display-diagrams-GUITAR").click();
  await page.locator("[data-testid=chord-strip][data-instrument=guitar]").waitFor();
  await panel().getByTestId("display-tuning").selectOption("drop-d");
  await panel().getByTestId("display-left-handed-yes").click();
  await page.locator("[data-left-handed]").first().waitFor();
  for (let i = 0; i < 30; i++) {
    const account = await api(me, "GET", "/users/me");
    if (account.guitarTuning === "drop-d" && account.leftHanded === true) break;
    if (i === 29) throw new Error(JSON.stringify({ tuning: account.guitarTuning, leftHanded: account.leftHanded }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

await step("Layout: columns", async () => {
  await panel().getByTestId("display-section").click();
  await page.getByTestId("display-section-layout").click();
  await panel().getByTestId("display-columns-2").click();
  await page.locator('[data-testid="song-chart"][data-columns="2"]').waitFor();
  await panel().getByTestId("display-close").click();
  await panel().waitFor({ state: "detached" });
});

await step("saved for Practice only, kept over a reload", async () => {
  const saved = await savedSettings((found) => found.PRACTICE?.columns === "2");
  const practice = saved.PRACTICE;
  if (practice.font !== "sans" || practice.spacing !== "relaxed" || practice.textSize !== 1.25 || practice.chordNotation !== "NASHVILLE" || practice.chordDiagrams !== "GUITAR")
    throw new Error(JSON.stringify(saved));
  if (saved.LIVE || saved.EDIT) throw new Error(`other modes changed: ${JSON.stringify(saved)}`);
  const account = await api(me, "GET", "/users/me");
  if (account.chordNotation !== "LETTERS" || account.chordDiagrams !== "OFF") throw new Error("the account's own settings changed");
  await page.reload();
  await page.locator('[data-testid="song-chart"][data-font="sans"][data-columns="2"]').waitFor();
});

await step("Live keeps its own: monospace, bigger text; changed there, for Live", async () => {
  await page.goto(`${WEB}/library/${song.id}/live`);
  await page.getByTestId("live-view").waitFor();
  await page.locator('[data-testid="song-chart"][data-font="mono"]').waitFor();
  await page.getByTestId("display-open").click();
  await page.getByTestId("display-mode").getByText("For Live mode").waitFor();
  // The section last picked (Layout) comes back.
  await panel().getByTestId("display-columns-auto").waitFor();
  await panel().getByTestId("display-section").click();
  await page.getByTestId("display-section-text").click();
  await panel().getByTestId("display-size").getByText("150%").waitFor();
  await panel().getByTestId("display-spacing-compact").click();
  await page.locator('[data-testid="song-chart"][data-spacing="compact"]').waitFor();
  // Live's own scroll still works with the panel open.
  await page.getByTestId("live-scroll").evaluate((el) => el.scrollBy(0, 50));
  await savedSettings((found) => found.LIVE?.spacing === "compact" && found.PRACTICE?.spacing === "relaxed");
});

await step("Reset: the mode back to the account's settings", async () => {
  await panel().getByTestId("display-reset").click();
  await page.locator('[data-testid="song-chart"][data-spacing="normal"]').waitFor();
  await savedSettings((found) => !found.LIVE && !!found.PRACTICE);
});

await step("a large screen: a column down the right, every section at once, the page making room", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await chart().waitFor();
  const before = await chart().evaluate((el) => el.getBoundingClientRect().right);
  await page.getByTestId("display-open").click();
  await panel().waitFor();
  // Once it has slid in.
  await page.waitForFunction(() => Math.round(document.querySelector('[data-testid="display-panel"]').getBoundingClientRect().right) === window.innerWidth);
  const box = await panel().boundingBox();
  if (!box || Math.round(box.x + box.width) !== 1440 || box.height < 880 || box.width > 340) throw new Error(`not a column on the right: ${JSON.stringify(box)}`);
  if ((await panel().getByTestId("display-section").count()) > 0) throw new Error("a section list on a large screen");
  for (const section of ["text", "chords", "instrument", "layout"]) await panel().getByTestId(`display-block-${section}`).waitFor();
  // The chart moves over rather than going under the panel.
  await page.waitForFunction((x) => document.querySelector('[data-testid="song-chart"]').getBoundingClientRect().right <= x, box.x);
  if ((await chart().evaluate((el) => el.getBoundingClientRect().right)) >= before) throw new Error("the page didn't make room");
  await panel().getByTestId("display-font-mono").click();
  await page.locator('[data-testid="song-chart"][data-font="mono"]').waitFor();
  await panel().getByTestId("display-close").click();
  await panel().waitFor({ state: "detached" });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-side-panel"));
});

await step("a large screen: each section folds away and opens again, remembered (issue #265)", async () => {
  await page.getByTestId("display-open").click();
  const chords = panel().getByTestId("display-block-chords");
  await chords.getByTestId("display-notation-LETTERS").waitFor();
  await panel().getByTestId("display-fold-chords").click();
  await chords.getByTestId("display-notation-LETTERS").waitFor({ state: "detached" });
  if ((await panel().getByTestId("display-fold-chords").getAttribute("aria-expanded")) !== "false") throw new Error("not said to be folded");
  // The others stay open.
  await panel().getByTestId("display-block-text").getByTestId("display-font-mono").waitFor();
  await page.reload();
  await chart().waitFor();
  await page.getByTestId("display-open").click();
  await panel().getByTestId("display-block-chords").waitFor();
  if ((await panel().getByTestId("display-block-chords").getAttribute("data-folded")) === null) throw new Error("not remembered");
  await panel().getByTestId("display-fold-chords").click();
  await panel().getByTestId("display-block-chords").getByTestId("display-notation-LETTERS").waitFor();
  await panel().getByTestId("display-close").click();
});

await browser.close();
finish();
