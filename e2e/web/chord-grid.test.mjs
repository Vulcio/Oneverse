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
  // Loop bars, Edit bars and the words' place are in the Display panel's Grid section (issue #408).
  const fromDisplay = async (testId) => {
    await page.getByTestId("display-open").first().click();
    await page.getByTestId(testId).click();
    if (await page.getByTestId("display-panel").isVisible()) await page.getByTestId("display-close").click();
    await page.getByTestId("display-panel").waitFor({ state: "hidden" });
  };

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

  await step("Grid for 1.0 (issue #408): no bars row over the grid, no toolbar, bars a row that fit a phone", async () => {
    // The bars row repeats the grid: not shown while the grid is, back with the chart.
    if (await page.getByTestId("bars-row").count()) throw new Error("the bars row shows over the grid");
    if (await page.getByTestId("chord-grid-toolbar").count()) throw new Error("the grid still has its toolbar");
    await page.getByTestId("chart-view-chart").click();
    await page.getByTestId("bars-row").waitFor();
    await page.getByTestId("chart-view-grid").click();
    await page.getByTestId("bars-row").waitFor({ state: "detached" });
    // The Display panel opens on the grid's section; the bars row brought back from there.
    await fromDisplay("display-gridBarsRow-shown");
    await page.getByTestId("bars-row").waitFor();
    await fromDisplay("display-gridBarsRow-hidden");
    await page.getByTestId("bars-row").waitFor({ state: "detached" });
    // A phone in portrait: one 4/4 bar a row in Practice; two when asked.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-testid="chord-grid-bars"][data-per-row="1"]').first().waitFor();
    await page.getByTestId("display-open").first().click();
    if ((await page.getByTestId("display-section").innerText()).trim() !== "Grid") throw new Error(`the panel opened on ${await page.getByTestId("display-section").innerText()}`);
    await page.getByTestId("display-gridBarsPerRow-2").click();
    await page.getByTestId("display-close").click();
    await page.locator('[data-testid="chord-grid-bars"][data-per-row="2"]').first().waitFor();
    await page.screenshot({ path: `${SP}/chord-grid-phone.png` });
    await fromDisplay("display-gridBarsPerRow-auto");
    await page.locator('[data-testid="chord-grid-bars"][data-per-row="1"]').first().waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-testid="chord-grid-bars"][data-per-row="4"]').first().waitFor();
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
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="chord-grid"][data-source="click"]').waitFor();
    await grid().locator("[data-grid-bar][data-on]").waitFor({ timeout: 5000 });
    // 150 BPM: two and a half beats a second.
    await page.waitForTimeout(3200);
    const [bar] = ((await grid().getAttribute("data-position")) ?? "").split(":").map(Number);
    if (!(bar >= 1)) throw new Error(`still at ${await grid().getAttribute("data-position")}`);
    if ((await grid().locator("[data-grid-bar][data-on]").count()) !== 1) throw new Error("not one bar lit");
    if ((await grid().locator("[data-grid-beat][data-on]").count()) !== 1) throw new Error("not one beat lit");
    await page.screenshot({ path: `${SP}/chord-grid-playing.png` });
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="chord-grid"]:not([data-source])').waitFor();
    if (await grid().locator("[data-grid-bar][data-on]").count()) throw new Error("a bar still lit");
  });

  // Where the words go (issue #376): in the bars, between the rows, under a pinned row, or off - kept on the device.
  const lyricsAs = async (choice) => {
    await fromDisplay(`display-gridLyrics-${choice}`);
    await page.locator(`[data-testid="chord-grid"][data-lyrics="${choice}"]`).waitFor();
  };
  const playClick = async () => {
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="chord-grid"][data-source="click"]').waitFor();
  };
  const stopClick = async () => {
    await page.getByTestId("practice-metronome").click();
    await page.locator('[data-testid="chord-grid"]:not([data-source])').waitFor();
  };

  await step("lyrics between the rows: a row's words as a line under it, the bar being played's lit", async () => {
    await lyricsAs("between");
    if (await grid().locator("[data-grid-words]").count()) throw new Error("words still in the bars");
    const rows = await grid().getByTestId("chord-grid-lyric-row").allInnerTexts();
    // Bars 1-4, 5-8, then the chorus's 10-11 (bar 9 sings nothing).
    if (rows.length !== 3 || !rows[0].includes("Amazing grace how sweet the sound") || !rows[1].includes("wretch like") || !rows[2].includes("My chains are gone")) throw new Error(JSON.stringify(rows));
    if ((await grid().locator("[data-grid-beat]").count()) !== 44) throw new Error("not every beat");
    await playClick();
    await grid().locator("[data-lyric-bar][data-on]").first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: `${SP}/chord-grid-between.png` });
    await stopClick();
  });

  await step("lyrics under a pinned row: one row of bars at the top, the line being sung lit under it", async () => {
    await lyricsAs("pinned");
    const pinned = grid().getByTestId("chord-grid-pinned");
    await pinned.locator("[data-grid-row][data-shown]").waitFor();
    if ((await pinned.locator("[data-grid-row][data-shown] [data-grid-bar]").count()) !== 4) throw new Error("not four bars pinned");
    const lines = await grid().locator("[data-lyric-line]").allInnerTexts();
    if (lines.map((one) => one.trim()).join(" | ") !== "Amazing grace how sweet the sound | That saved a wretch like me | I once was lost | My chains are gone") throw new Error(lines.join(" | "));
    await playClick();
    // 150 BPM: past bar 4 in under 8 s, and the row pinned moves on with it.
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chord-grid"]')?.dataset.position?.split(":")[0]) >= 4, null, { timeout: 10000 });
    const lit = await grid().locator("[data-grid-bar][data-on]").getAttribute("data-grid-bar");
    const shown = (await pinned.locator("[data-grid-row][data-shown]").getAttribute("data-bars")).split(" ");
    if (!shown.includes(lit)) throw new Error(`bar ${lit} not in the pinned row ${shown}`);
    if ((await grid().locator("[data-lyric-line][data-on]").count()) !== 1) throw new Error("not one line lit");
    await page.screenshot({ path: `${SP}/chord-grid-pinned.png` });
    await stopClick();
  });

  await step("lyrics off: only the bars, still off after a reload; In the bars brings them back", async () => {
    await lyricsAs("off");
    if (await grid().locator("[data-grid-words], [data-lyric-line], [data-testid=chord-grid-lyric-row]").count()) throw new Error("words still shown");
    await page.reload();
    await page.locator('[data-testid="chord-grid"][data-lyrics="off"]').waitFor();
    await lyricsAs("bars");
    if ((await grid().locator("[data-grid-words]").count()) !== 11) throw new Error("the words aren't back in the bars");
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
