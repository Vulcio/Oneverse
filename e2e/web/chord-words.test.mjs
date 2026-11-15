// Edit bars showing the word each chord is sung on (issue #477): every chord's syllable underlined in the bars' words,
// the chord pointed at, picked or dragged lighting its word (and its syllable), a syllable pointed at lighting its
// chord, and the picked chord's place naming its word. Moving a chord in the bars leaves it on its word.
// Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Chord words");
const content = ["{start_of_verse: Verse 1}", "[C]When peace like a [F]river at[C]tendeth my way", "[Am]When sorrows like [G]sea billows roll", "{end_of_verse}", ""].join("\n");
const song = await api(me, "POST", "/song-versions", { title: `Chord words ${stamp}`, language: "en", artists: ["Spafford"], key: "C", tempo: 72, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const grid = () => page.getByTestId("chord-grid");
  const bar = (index) => grid().locator("[data-grid-bar]").nth(index);
  // The letters marked with `attribute`, joined into runs: ["river"].
  const runs = (attribute) =>
    grid().evaluate((element, name) => {
      const out = [];
      let last = null;
      for (const letter of element.querySelectorAll("[data-letter]")) {
        if (!letter.hasAttribute(name)) {
          last = null;
          continue;
        }
        const key = `${letter.dataset.line}`;
        const at = Number(letter.dataset.at);
        if (last && last.key === key && last.at === at - 1) out[out.length - 1] += letter.textContent;
        else out.push(letter.textContent);
        last = { key, at };
      }
      return out;
    }, attribute);
  const expectRuns = async (attribute, expected) => {
    const got = await runs(attribute);
    if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`${attribute}: ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
  };

  await step("Edit bars: every chord's syllable underlined", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("chart-view-grid").click();
    await grid().waitFor();
    await page.getByTestId("display-open").first().click();
    await page.getByTestId("chord-grid-edit-start").click();
    if (await page.getByTestId("display-panel").isVisible()) await page.getByTestId("display-close").click();
    await page.getByTestId("chord-grid-edit").waitFor();
    // "at[C]tendeth": the C's syllable is "tendeth", the "at" before it nobody's.
    await expectRuns("data-chord-word", ["When", "river", "tendeth", "When", "sea"]);
    await expectRuns("data-lit", []);
  });

  await step("a chord pointed at lights its word and syllable", async () => {
    await bar(0).locator('[data-grid-chord="F"]').hover();
    await expectRuns("data-lit", ["river"]);
    await expectRuns("data-lit-word", ["river"]);
    await page.mouse.move(5, 5);
    await expectRuns("data-lit", []);
  });

  await step("picked: the whole word lit, the syllable marked, the word in its place", async () => {
    await bar(1).locator('[data-grid-chord="C"]').click();
    const tools = page.getByTestId("chord-tools");
    await tools.waitFor();
    await page.mouse.move(5, 5);
    await expectRuns("data-lit", ["tendeth"]);
    await expectRuns("data-lit-word", ["attendeth"]);
    if (!(await tools.innerText()).includes("on “attendeth”")) throw new Error(await tools.innerText());
    await page.screenshot({ path: `${SP}/chord-words-picked.png` });
    await tools.getByTestId("chord-tools-done").click();
    await tools.waitFor({ state: "detached" });
  });

  await step("a syllable pointed at lights its chord", async () => {
    await grid().locator('[data-letter][data-chord-word]').filter({ hasText: "s" }).first().hover();
    const lit = grid().locator("[data-grid-chord][data-lit]");
    if ((await lit.count()) !== 1 || (await lit.getAttribute("data-grid-chord")) !== "G") throw new Error(`lit: ${await lit.count()}`);
    await page.mouse.move(5, 5);
  });

  await step("dragged: its word stays lit, and it stays on it once dropped", async () => {
    const from = await bar(0).locator('[data-grid-chord="F"]').boundingBox();
    const to = await bar(0).locator('[data-grid-slot][data-beat="4"]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await expectRuns("data-lit", ["river"]);
    await page.screenshot({ path: `${SP}/chord-words-drag.png` });
    await page.mouse.up();
    await bar(0).locator('[data-grid-chord="F"][data-beat-at="4"]').waitFor();
    await expectRuns("data-chord-word", ["When", "river", "tendeth", "When", "sea"]);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
