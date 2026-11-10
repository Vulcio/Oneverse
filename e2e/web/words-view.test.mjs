// The Words view (issue #416): a song's words laid out for singers - Chart / Grid / Words - big, without chords, in the
// order they're sung, section names as badges, a part without words as one line with its bars. Its options are the
// Display panel's Words section (repeats once, small chords, line by line...), and the sections bar shows over it and
// over the grid unless turned off. Following the metronome, the line being sung stands out. Kept for the song like the
// other views, so Live shows it too, and "Songs read as" can make it the default. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Words reader");
const line = (id, text, chords = []) => ({ id, kind: "lyric", text, chords: chords.map(([at, raw], i) => ({ id: `${id}_${i}`, at, raw })) });
const intro = { id: `in${stamp}`, type: "intro", label: null, lines: [line(`in${stamp}a`, "", [[0, "G"], [0, "C"]])] };
const verse1 = { id: `v1${stamp}`, type: "verse", label: null, lines: [line(`v1${stamp}a`, "Amazing grace how sweet the sound", [[0, "G"], [8, "C"]]), line(`v1${stamp}b`, "That saved a wretch like me", [[0, "G"], [12, "D"]])] };
const chorus = { id: `ch${stamp}`, type: "chorus", label: null, lines: [line(`ch${stamp}a`, "My chains are gone", [[0, "C"], [14, "G"]])] };
const verse2 = { id: `v2${stamp}`, type: "verse", label: null, lines: [line(`v2${stamp}a`, "Twas grace that taught my heart to fear", [[0, "G"], [10, "C"]])] };
const sections = [intro, verse1, chorus, verse2];
const flow = [intro, verse1, chorus, chorus, verse2, chorus].map((section, i) => ({ id: `f${i}${stamp}`, sectionId: section.id }));
const song = await api(me, "POST", "/song-versions", { title: `Words ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 160, timeSignature: "4/4" });
await api(me, "PATCH", `/song-versions/${song.id}`, { sections, flow });
const other = await api(me, "POST", "/song-versions", { title: `Words default ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const words = () => page.getByTestId("words-view");
  const labels = async () => (await words().getByTestId("words-label").allInnerTexts()).map((one) => one.trim().toLowerCase());
  const display = async (testId) => {
    if (!(await page.getByTestId("display-panel").isVisible())) await page.getByTestId("display-open").first().click();
    await page.getByTestId(testId).click();
  };
  const closeDisplay = async () => {
    await page.getByTestId("display-close").click();
    await page.getByTestId("display-panel").waitFor({ state: "hidden" });
  };

  await step("Practice: Words shows the words in the order they're sung, no chords, badges, the intro as one line", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("song-chart").waitFor();
    await page.getByTestId("chart-view-words").click();
    await words().waitFor();
    if (await page.getByTestId("song-chart").count()) throw new Error("the chart still shows");
    if ((await page.getByTestId("chart-view-words").getAttribute("aria-pressed")) !== "true") throw new Error("Words not pressed");
    const lines = await words().getByTestId("words-line").allInnerTexts();
    const expected = ["Amazing grace how sweet the sound", "That saved a wretch like me", "My chains are gone", "My chains are gone", "Twas grace that taught my heart to fear", "My chains are gone"];
    if (JSON.stringify(lines.map((one) => one.trim())) !== JSON.stringify(expected)) throw new Error(JSON.stringify(lines));
    if (await words().getByTestId("words-chord").count()) throw new Error("chords show");
    const named = await labels();
    if (named.join("|") !== "intro|verse 1|chorus|chorus|verse 2|chorus") throw new Error(named.join("|"));
    if (!/instrumental · \d+ bars?/i.test(await words().getByTestId("words-instrumental").innerText())) throw new Error(await words().getByTestId("words-instrumental").innerText());
    // No bars row over it; the sections bar instead, and the next section cued.
    if (await page.getByTestId("bars-row").count()) throw new Error("the bars row shows over the words");
    await page.getByTestId("live-structure").waitFor();
    await words().getByTestId("words-next").waitFor();
    await page.screenshot({ path: `${SP}/words-practice.png` });
  });

  await step("Display opens on Words: repeats once, small chords, then back", async () => {
    await page.getByTestId("display-open").first().click();
    if ((await page.getByTestId("display-section").innerText()).trim() !== "Words") throw new Error(`the panel opened on ${await page.getByTestId("display-section").innerText()}`);
    await page.screenshot({ path: `${SP}/words-display.png` });
    await display("display-wordsRepeats-once");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="words-line"]').length === 4);
    const named = await labels();
    if (!named.includes("chorus ×2")) throw new Error(named.join("|"));
    await words().getByTestId("words-again").waitFor();
    await display("display-wordsChords-on");
    await words().getByTestId("words-chord").first().waitFor();
    await display("display-wordsRepeats-written");
    await display("display-wordsChords-off");
    await closeDisplay();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="words-line"]').length === 6);
  });

  await step("Line by line: the line being read big, a tap to the next", async () => {
    await display("display-wordsLayout-lines");
    await closeDisplay();
    await words().getByTestId("words-lines").waitFor();
    const now = () => words().locator('[data-testid="words-line"][data-sung="now"]').innerText();
    if (!/instrumental/i.test(await now())) throw new Error(await now());
    await words().getByTestId("words-forward").click();
    if ((await now()).trim() !== "Amazing grace how sweet the sound") throw new Error(await now());
    await page.screenshot({ path: `${SP}/words-lines.png` });
    await display("display-wordsLayout-scroll");
    await closeDisplay();
    await words().getByTestId("words-lines").waitFor({ state: "detached" });
  });

  await step("the sections bar can be turned off, over the words and over the grid", async () => {
    await display("display-sectionsBar-hidden");
    await closeDisplay();
    await page.getByTestId("live-structure").waitFor({ state: "detached" });
    await page.getByTestId("chart-view-grid").click();
    await page.getByTestId("chord-grid").waitFor();
    if (await page.getByTestId("live-structure").count()) throw new Error("the sections bar shows over the grid");
    await display("display-sectionsBar-shown");
    await closeDisplay();
    await page.getByTestId("live-structure").waitFor();
    // Not over the chart.
    await page.getByTestId("chart-view-chart").click();
    await page.getByTestId("song-chart").waitFor();
    if (await page.getByTestId("live-structure").count()) throw new Error("the sections bar shows over the chart");
    await page.getByTestId("chart-view-words").click();
    await words().waitFor();
  });

  await step("following the metronome: the line being sung stands out", async () => {
    await page.getByTestId("practice-metronome").click();
    await words().locator("[data-following]").or(page.locator('[data-testid="words-view"][data-following]')).first().waitFor({ timeout: 10000 });
    await words().locator('[data-sung="now"]').first().waitFor();
    await page.screenshot({ path: `${SP}/words-following.png` });
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="words-view"]:not([data-following])').waitFor();
  });

  await step("kept for the song: Words again after a reload, and in Live, where A+ makes the words bigger", async () => {
    for (let i = 0; i < 30; i++) {
      const saved = await api(me, "GET", `/chart-preferences?songVersionId=${song.id}`);
      if (saved?.view === "WORDS") break;
      if (i === 29) throw new Error(`not saved: ${JSON.stringify(saved)}`);
      await page.waitForTimeout(200);
    }
    await page.reload();
    await words().waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await page.goto(`${WEB}/library/${song.id}/live`);
    await words().waitFor();
    await page.getByTestId("live-structure").waitFor();
    const size = () => words().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const before = await size();
    await page.getByRole("button", { name: "Bigger text" }).first().click();
    await page.waitForFunction((was) => parseFloat(getComputedStyle(document.querySelector('[data-testid="words-view"]')).fontSize) > was, before);
    await page.screenshot({ path: `${SP}/words-live.png` });
  });

  await step("Songs read as Words: a song never switched opens on its words", async () => {
    await api(me, "PATCH", "/users/me", { liveView: "WORDS" });
    await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
    await page.goto(`${WEB}/library/${other.id}`);
    await words().waitFor();
    if ((await words().getByTestId("words-line").innerText()).trim() !== "Hello world") throw new Error(await words().getByTestId("words-line").innerText());
  });

  await step("no errors on the page", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
