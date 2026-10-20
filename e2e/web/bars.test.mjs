// Bars (issue #238): the bars row at the top of Practice and Live - the song's chords in bars and beats, a cell a
// beat, filled in from the chart (a chord a bar, a sung line at least two), each section named on its first bar,
// with the metronome at its left. Started there, the click lights the current beat and the row slides with it; the
// Display panel turns it off, per mode. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Bars player");
const song = await api(me, "POST", "/song-versions", {
  title: `Bars ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  tempo: 150,
  timeSignature: "4/4",
  content:
    "{start_of_verse}\n[G]Amazing [C]grace how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\nI once was lost\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const row = () => page.getByTestId("bars-row");
  const strip = () => page.getByTestId("bars-strip");

  await step("Practice: the bars filled in from the chart, a cell a beat, the sections named", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await row().waitFor();
    // Verse: 4 chords, 3 chords, a line without (2 bars); chorus: 2 chords, carried to 2 bars.
    const bars = await strip().locator("[data-bar]").count();
    if (bars !== 11) throw new Error(`${bars} bars`);
    const cells = await strip().locator("[data-beat]").count();
    if (cells !== 44) throw new Error(`${cells} cells`);
    const chords = await strip().locator("[data-chord]").allInnerTexts();
    if (chords.join(" ") !== "G C G D G Em D C G") throw new Error(chords.join(" "));
    const sections = await strip().getByTestId("bars-section").allInnerTexts();
    if (sections.join(" ") !== "V C") throw new Error(sections.join(" "));
    if (!(await row().getByTestId("bars-metronome").innerText()).includes("150")) throw new Error("not the song's tempo");
    await row().screenshot({ path: `${SP}/bars-row.png` });
  });

  await step("the click from the row: the current beat lit, the row sliding with it", async () => {
    await row().getByTestId("bars-metronome").click();
    await page.locator('[data-testid="bars-row"][data-source="click"]').waitFor();
    await strip().locator("[data-beat][data-on]").waitFor({ timeout: 5000 });
    const first = await strip().getAttribute("data-position");
    // 150 BPM: two and a half beats a second.
    await page.waitForTimeout(3200);
    const later = await strip().getAttribute("data-position");
    const [bar] = (later ?? "").split(":").map(Number);
    if (!(bar >= 1)) throw new Error(`still at ${later} (from ${first})`);
    if ((await strip().evaluate((el) => el.scrollLeft)) <= 0) throw new Error("the row didn't slide");
    if ((await strip().locator("[data-beat][data-on]").count()) !== 1) throw new Error("not one beat lit");
    await page.screenshot({ path: `${SP}/bars-practice.png` });
  });

  await step("stopped: nothing lit", async () => {
    await row().getByTestId("bars-metronome").click();
    await page.locator('[data-testid="bars-row"]:not([data-source])').waitFor();
    if ((await strip().locator("[data-beat][data-on]").count()) !== 0) throw new Error("a beat still lit");
  });

  await step("Live: the row under the header", async () => {
    await page.goto(`${WEB}/library/${song.id}/live`);
    await row().waitFor();
    await page.screenshot({ path: `${SP}/bars-live.png` });
  });

  await step("the Display panel turns the bars off, for this mode only", async () => {
    await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
    await page.goto(`${WEB}/library/${song.id}`);
    await row().waitFor();
    await page.getByTestId("display-open").click();
    await page.getByTestId("display-panel").getByTestId("display-bars-hidden").click();
    await row().waitFor({ state: "detached" });
    for (let i = 0; i < 30; i++) {
      const saved = (await api(me, "GET", "/users/me")).displaySettings ?? {};
      if (saved.PRACTICE?.bars === false) break;
      if (i === 29) throw new Error(`not saved: ${JSON.stringify(saved)}`);
      await page.waitForTimeout(200);
    }
    await page.goto(`${WEB}/library/${song.id}/live`);
    await row().waitFor();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
}
finish();
