// The chord grid (issue #238): a song read as its chords in bars - Chart / Grid / PDF - four bars a row, each with its
// number, its beats, the chord where it changes and the words sung in it. The choice is kept for the player as the
// PDF's is (issue #155), so Live and a set's song page show it too, and "Songs read as" can make it the default. As
// the metronome plays, the bar and beat being played light up. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Grid reader");
const content =
  "{start_of_verse}\n[G]Amazing [C]grace how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\nI once was lost\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n";
const song = await api(me, "POST", "/song-versions", { title: `Grid ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 150, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });
const other = await api(me, "POST", "/song-versions", { title: `Grid default ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO" });
const set = await api(me, "POST", "/setlists", { name: `Grid set ${stamp}` });
const [item] = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const grid = () => page.getByTestId("chord-grid");

  await step("Practice: Grid shows the bars, four a row, the chords where they change and the words under them", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("song-chart").waitFor();
    await page.getByTestId("chart-view-grid").click();
    await grid().waitFor();
    if (await page.getByTestId("song-chart").count()) throw new Error("the chart still shows");
    if ((await page.getByTestId("chart-view-grid").getAttribute("aria-pressed")) !== "true") throw new Error("Grid not pressed");
    // As the bars row: the verse's 4 + 3 chords and a line without (2 bars), the chorus's 2 chords.
    const bars = grid().locator("[data-grid-bar]");
    if ((await bars.count()) !== 11) throw new Error(`${await bars.count()} bars`);
    if ((await grid().locator("[data-grid-beat]").count()) !== 44) throw new Error("not four beats a bar");
    const chords = await grid().locator("[data-grid-chord]").allInnerTexts();
    if (chords.join(" ") !== "G C G D G Em D C G") throw new Error(chords.join(" "));
    const words = (await grid().locator("[data-grid-words]").allInnerTexts()).map((one) => one.trim());
    const expected = ["Amazing", "grace how", "sweet the", "sound", "That saved a", "wretch like", "me", "I once was lost", "", "My chains are", "gone"];
    if (JSON.stringify(words) !== JSON.stringify(expected)) throw new Error(JSON.stringify(words));
    // The line without a chord holds D: named again, quietly, in its bars.
    if ((await grid().locator('[data-grid-carried="D"]').count()) !== 2) throw new Error("the held chord isn't named");
    const headings = await grid().getByTestId("chord-grid-heading").allInnerTexts();
    if (headings.map((one) => one.toLowerCase()).join(" ") !== "verse chorus") throw new Error(headings.join(" "));
    // Four bars a row on a wide screen.
    const tops = await bars.evaluateAll((all) => all.slice(0, 5).map((el) => Math.round(el.getBoundingClientRect().top)));
    if (new Set(tops.slice(0, 4)).size !== 1 || tops[4] <= tops[0]) throw new Error(`rows: ${tops}`);
    await grid().screenshot({ path: `${SP}/chord-grid.png` });
  });

  await step("the choice is kept for the song: the grid again after a reload", async () => {
    for (let i = 0; i < 30; i++) {
      const saved = await api(me, "GET", `/chart-preferences?songVersionId=${song.id}`);
      if (saved?.view === "GRID") break;
      if (i === 29) throw new Error(`not saved: ${JSON.stringify(saved)}`);
      await page.waitForTimeout(200);
    }
    await page.reload();
    await grid().waitFor();
  });

  await step("the metronome plays: the bar and the beat being played light up, and move on", async () => {
    await page.getByTestId("bars-metronome").click();
    await page.locator('[data-testid="chord-grid"][data-source="click"]').waitFor();
    await grid().locator("[data-grid-bar][data-on]").waitFor({ timeout: 5000 });
    // 150 BPM: two and a half beats a second.
    await page.waitForTimeout(3200);
    const [bar] = ((await grid().getAttribute("data-position")) ?? "").split(":").map(Number);
    if (!(bar >= 1)) throw new Error(`still at ${await grid().getAttribute("data-position")}`);
    if ((await grid().locator("[data-grid-bar][data-on]").count()) !== 1) throw new Error("not one bar lit");
    if ((await grid().locator("[data-grid-beat][data-on]").count()) !== 1) throw new Error("not one beat lit");
    await page.screenshot({ path: `${SP}/chord-grid-playing.png` });
    await page.getByTestId("bars-metronome").click();
    await page.locator('[data-testid="chord-grid"]:not([data-source])').waitFor();
    if (await grid().locator("[data-grid-bar][data-on]").count()) throw new Error("a bar still lit");
  });

  await step("Live reads it as the grid too, and switches back to the chart", async () => {
    await page.goto(`${WEB}/library/${song.id}/live`);
    await page.getByTestId("live-view").getByTestId("chord-grid").waitFor();
    await page.screenshot({ path: `${SP}/chord-grid-live.png` });
    await page.getByTestId("chart-view-chart").click();
    await page.getByTestId("live-view").getByTestId("song-chart").waitFor();
    if (await grid().count()) throw new Error("the grid still shows");
  });

  await step("a set's song page: Grid, kept for the song as the set plays it", async () => {
    await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
    await page.getByTestId("song-chart").waitFor();
    await page.getByTestId("chart-view-grid").click();
    await grid().waitFor();
    if ((await grid().locator("[data-grid-bar]").count()) !== 11) throw new Error("not the song's bars");
    for (let i = 0; i < 30; i++) {
      const saved = (await api(me, "GET", `/setlists/${set.id}/items/${item.id}/song`)).view.preferences;
      if (saved?.view === "GRID") break;
      if (i === 29) throw new Error(`not saved: ${JSON.stringify(saved)}`);
      await page.waitForTimeout(200);
    }
  });

  await step("Songs read as: Chord grid makes it the default for songs not chosen for", async () => {
    await api(me, "PATCH", "/users/me", { liveView: "GRID" });
    await page.goto(`${WEB}/library/${other.id}`);
    await grid().waitFor();
    if ((await grid().locator("[data-grid-chord]").allInnerTexts()).join(" ") !== "G C") throw new Error("not its chords");
    await api(me, "PATCH", "/users/me", { liveView: "CHART" });
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
}
finish();
