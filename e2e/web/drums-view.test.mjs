// The Drums view (issue #107) and the metronome's displays (issue #443): Chart / Grid / Words / Drums shows a song for
// a drummer - its sections as badges with their bars, the tempo and time signature big, the words and the next section,
// the whole background the metronome's beat in columns lit in their level's colour. Without the music playing, Next
// section and a pedal's page keys step through; playing, it follows. Display's Metronome section puts the beat on any
// song's page (blocks, a count, the background), and its Drums section hides the words or the next section. Kept for
// the song like the other views, so Live shows it too. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Drummer");
const line = (id, text, chords = []) => ({ id, kind: "lyric", text, chords: chords.map(([at, raw], i) => ({ id: `${id}_${i}`, at, raw })) });
const intro = { id: `in${stamp}`, type: "intro", label: null, lines: [line(`in${stamp}a`, "", [[0, "G"], [0, "C"]])] };
const verse = { id: `v1${stamp}`, type: "verse", label: null, lines: [line(`v1${stamp}a`, "Amazing grace how sweet the sound", [[0, "G"], [8, "C"]]), line(`v1${stamp}b`, "That saved a wretch like me", [[0, "G"], [12, "D"]])] };
const chorus = { id: `ch${stamp}`, type: "chorus", label: null, lines: [line(`ch${stamp}a`, "My chains are gone", [[0, "C"], [14, "G"]])] };
const sections = [intro, verse, chorus];
const flow = [intro, verse, chorus].map((section, i) => ({ id: `f${i}${stamp}`, sectionId: section.id }));
const song = await api(me, "POST", "/song-versions", { title: `Drums ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 160, timeSignature: "4/4" });
await api(me, "PATCH", `/song-versions/${song.id}`, { sections, flow });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const drums = () => page.getByTestId("drums-view");
  const current = async () => (await drums().getByTestId("drums-current").innerText()).trim().toLowerCase();
  const display = async (testId) => {
    if (!(await page.getByTestId("display-panel").isVisible())) await page.getByTestId("display-open").first().click();
    await page.getByTestId(testId).click();
  };
  const closeDisplay = async () => {
    await page.getByTestId("display-close").click();
    await page.getByTestId("display-panel").waitFor({ state: "hidden" });
  };

  await step("Practice: Drums shows the sections as badges, the tempo, the words and the next section", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("song-chart").waitFor();
    await page.getByTestId("chart-view-drums").click();
    await drums().waitFor();
    if (await page.getByTestId("song-chart").count()) throw new Error("the chart still shows");
    if ((await page.getByTestId("chart-view-drums").getAttribute("aria-pressed")) !== "true") throw new Error("Drums not pressed");
    if ((await drums().getByTestId("drums-section").count()) !== 3) throw new Error(`${await drums().getByTestId("drums-section").count()} badges`);
    if ((await current()) !== "intro") throw new Error(await current());
    if (!/160/.test(await drums().getByTestId("drums-tempo").innerText())) throw new Error(await drums().getByTestId("drums-tempo").innerText());
    if (!/4\/4/.test(await drums().getByTestId("drums-tempo").innerText())) throw new Error("no time signature");
    if ((await drums().getByTestId("beat-columns").getAttribute("data-beats")) !== "4") throw new Error("not 4 columns");
    if (!/verse/i.test(await drums().getByTestId("drums-next-cue").innerText())) throw new Error(await drums().getByTestId("drums-next-cue").innerText());
    if (!/Amazing grace/.test(await drums().getByTestId("drums-next-cue").innerText())) throw new Error("the next section's first words don't show");
    if (await page.getByTestId("bars-row").count()) throw new Error("the bars row shows over the drums");
    await page.screenshot({ path: `${SP}/drums-practice.png` });
  });

  await step("not following: Next section, the page keys and a badge step through", async () => {
    await drums().getByTestId("drums-next").click();
    if ((await current()) !== "verse 1" && (await current()) !== "verse") throw new Error(await current());
    if (!/Amazing grace how sweet the sound/.test(await drums().getByTestId("drums-words").innerText())) throw new Error(await drums().getByTestId("drums-words").innerText());
    await page.keyboard.press("PageDown");
    if ((await current()) !== "chorus") throw new Error(await current());
    if (!(await drums().getByTestId("drums-next").isDisabled())) throw new Error("Next section at the last one");
    if (await drums().getByTestId("drums-next-cue").count()) throw new Error("a next section after the last");
    await page.keyboard.press("PageUp");
    if (!/verse/.test(await current())) throw new Error(await current());
    await drums().getByTestId("drums-section").first().click();
    if ((await current()) !== "intro") throw new Error(await current());
  });

  await step("Display's Drums section hides the words and the next section", async () => {
    await page.getByTestId("display-open").first().click();
    // A wide screen shows every section down the side, the view's own first.
    const first = await page.getByTestId("display-panel").locator('[data-testid^="display-block-"]').first().getAttribute("data-testid");
    if (first !== "display-block-drums") throw new Error(`the panel opened on ${first}`);
    await display("display-drumsNext-off");
    await display("display-drumsWords-off");
    await closeDisplay();
    if (await drums().getByTestId("drums-next-cue").count()) throw new Error("the next section still shows");
    await drums().getByTestId("drums-next").click();
    if (await drums().getByTestId("drums-words").count()) throw new Error("the words still show");
    await display("display-drumsNext-on");
    await display("display-drumsWords-on");
    await closeDisplay();
    await drums().getByTestId("drums-words").waitFor();
  });

  await step("following the metronome: the background lights up beat by beat", async () => {
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="drums-view"][data-following]').waitFor({ timeout: 10000 });
    await drums().locator('[data-testid="beat-columns"] [data-lit]').waitFor();
    const seen = new Set();
    for (let i = 0; i < 40 && seen.size < 2; i++) {
      const lit = await drums().locator('[data-testid="beat-columns"] > div').evaluateAll((columns) => columns.findIndex((one) => one.hasAttribute("data-lit")));
      if (lit >= 0) seen.add(lit);
      await page.waitForTimeout(60);
    }
    if (seen.size < 2) throw new Error(`only beat ${[...seen]} lit`);
    if ((await drums().getByTestId("drums-previous").count()) || (await drums().getByTestId("drums-next").count())) throw new Error("manual steps while following");
    await page.screenshot({ path: `${SP}/drums-following.png` });
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="drums-view"]:not([data-following])').waitFor();
  });

  await step("the metronome's background behind the chart, and its count", async () => {
    await page.getByTestId("chart-view-chart").click();
    await page.getByTestId("song-chart").waitFor();
    await page.getByTestId("display-open").first().click();
    await display("display-metronomeDisplay-background");
    await closeDisplay();
    if (await page.getByTestId("beat-columns").count()) throw new Error("the beat shows while nothing plays");
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="beat-columns"] [data-lit]').waitFor({ timeout: 10000 });
    if ((await page.getByTestId("beat-columns").evaluate((one) => getComputedStyle(one).position)) !== "fixed") throw new Error("not the whole page");
    await page.screenshot({ path: `${SP}/drums-metronome-background.png` });
    await display("display-metronomeDisplay-count");
    await closeDisplay();
    await page.getByTestId("beat-count").waitFor();
    if (await page.getByTestId("beat-columns").count()) throw new Error("the background still shows");
    await page.getByTestId("practice-metronome").click();
    await page.getByTestId("beat-count").waitFor({ state: "detached" });
    await display("display-metronomeDisplay-pill");
    await closeDisplay();
  });

  await step("kept for the song: Drums again in Live", async () => {
    await page.getByTestId("chart-view-drums").click();
    await drums().waitFor();
    for (let i = 0; i < 30; i++) {
      const saved = await api(me, "GET", `/chart-preferences?songVersionId=${song.id}`);
      if (saved?.view === "DRUMS") break;
      if (i === 29) throw new Error(`not saved: ${JSON.stringify(saved)}`);
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await page.goto(`${WEB}/library/${song.id}/live`);
    await drums().waitFor();
    if (await page.getByTestId("live-structure").count()) throw new Error("the sections bar shows over the drums");
    await page.screenshot({ path: `${SP}/drums-live.png` });
  });

  await step("no errors on the page", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
