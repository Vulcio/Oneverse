// Bars (issue #238): the bars row at the top of Practice and Live - the song's chords in bars and beats, a cell a
// beat, filled in from the chart (a chord a bar, a sung line at least two), each section named on its first bar,
// with the metronome at its left. Started there, the click lights the current beat and the row slides with it; the
// Display panel turns it off, per mode. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API, SP, WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

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
    const chords = await strip().locator("[data-bar-chord]").allInnerTexts();
    if (chords.join(" ") !== "G C G D G Em D C G") throw new Error(chords.join(" "));
    const sections = await strip().getByTestId("bars-section").allInnerTexts();
    if (sections.join(" ") !== "V C") throw new Error(sections.join(" "));
    if (!(await row().getByTestId("bars-metronome").innerText()).includes("150")) throw new Error("not the song's tempo");
    await row().screenshot({ path: `${SP}/bars-row.png` });
  });

  await step("on a phone, scrolled down: the row stays in view under the header, never behind it", async () => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    const header = await page.locator("header").first().boundingBox();
    const box = await row().boundingBox();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    if (!header || !box || box.y < header.y + header.height - 1) throw new Error(`behind the header: ${JSON.stringify({ header, box })}`);
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
    // Whole bars a page at a time: the lit beat always in view, its bar starting the page or after it.
    const inView = await strip().evaluate((el) => {
      const lit = el.querySelector("[data-beat][data-on]").getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return lit.left >= box.left - 1 && lit.right <= box.right + 1;
    });
    if (!inView) throw new Error("the lit beat isn't in view");
    if ((await strip().locator("[data-beat][data-on]").count()) !== 1) throw new Error("not one beat lit");
    await page.screenshot({ path: `${SP}/bars-practice.png` });
  });

  await step("on a phone: one whole bar and a peek at the next; when the next bar starts, the row turns to it at once", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const shown = () =>
      strip().evaluate((el) => {
        const box = el.getBoundingClientRect();
        const bars = [...el.querySelectorAll("[data-bar]")].map((bar) => ({ bar: Number(bar.dataset.bar), rect: bar.getBoundingClientRect() }));
        const whole = bars.filter((b) => b.rect.left >= box.left - 1 && b.rect.right <= box.right + 1).map((b) => b.bar);
        const peek = bars.find((b) => b.rect.left < box.right - 1 && b.rect.right > box.right + 1);
        const lit = el.querySelector("[data-beat][data-on]")?.closest("[data-bar]")?.dataset.bar;
        return { whole, peek: peek ? box.right - peek.rect.left : 0, lit: lit === undefined ? null : Number(lit), scroll: el.scrollLeft };
      });
    const seen = [];
    for (let i = 0; i < 40; i++) {
      seen.push(await shown());
      await page.waitForTimeout(100);
    }
    for (const view of seen) {
      if (view.whole.length !== 1 || view.peek < 15 || view.peek > 60) throw new Error(`not one bar and a peek: ${JSON.stringify(view)}`);
      if (view.lit !== null && view.whole[0] !== view.lit) throw new Error(`the lit bar isn't the one shown: ${JSON.stringify(view)}`);
    }
    // It turned (a new bar every 1.6 s at 150 BPM in 4/4), and only by whole bars: never part-way.
    const scrolls = new Set(seen.map((view) => view.scroll));
    if (scrolls.size < 2) throw new Error("it didn't turn");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("the chart follows the click (issue #365): the line being sung lit, then the next", async () => {
    const chart = page.getByTestId("practice-chart");
    const sung = chart.locator("[data-line][data-sung]");
    await sung.waitFor({ timeout: 5000 });
    if ((await sung.count()) !== 1) throw new Error("not one line lit");
    const first = await sung.innerText();
    // 150 BPM, a line of four bars or three: the next line within a few seconds.
    await page.waitForFunction((was) => {
      const lit = document.querySelector('[data-testid="practice-chart"] [data-line][data-sung]');
      return lit && lit.textContent !== was;
    }, first, { timeout: 12000 });
    await page.screenshot({ path: `${SP}/bars-sung-line.png` });
  });

  await step("stopped: nothing lit", async () => {
    await row().getByTestId("bars-metronome").click();
    await page.locator('[data-testid="bars-row"]:not([data-source])').waitFor();
    if ((await strip().locator("[data-beat][data-on]").count()) !== 0) throw new Error("a beat still lit");
    if ((await page.getByTestId("practice-chart").locator("[data-sung]").count()) !== 0) throw new Error("a line still lit");
  });

  await step("Live: the row under the header", async () => {
    await page.goto(`${WEB}/library/${song.id}/live`);
    await row().waitFor();
    await page.screenshot({ path: `${SP}/bars-live.png` });
  });

  await step("a recording with its own beats and bars (issue #299): the row follows them, not the song's tempo", async () => {
    // A recording whose beats come every quarter second (240 BPM), bars of four: the song's 150 BPM would be much slower.
    const form = new FormData();
    form.append("type", "AUDIO");
    form.append("file", new Blob([readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems/Morning Light - Bass.mp3"))], { type: "audio/mpeg" }), "Beats.mp3");
    const uploaded = await (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form })).json();
    const beats = Array.from({ length: 400 }, (_, i) => (i * 0.25).toFixed(3));
    const downbeats = beats.filter((_, i) => i % 4 === 0);
    sql(`update "Attachment" set "recordingBeats" = '{${beats.join(",")}}', "recordingDownbeats" = '{${downbeats.join(",")}}' where id = '${uploaded.id}'`);
    await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
    await page.goto(`${WEB}/library/${song.id}`);
    await row().waitFor();
    const player = page.getByTestId("stem-player");
    await player.getByRole("button", { name: "Play", exact: true }).click({ timeout: 20000 });
    await page.locator('[data-testid="bars-row"][data-source="stems"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(2600);
    // Four beats a second: past bar 2 after two and a half seconds; the song's tempo would still be in bar 2 at most.
    const [bar] = ((await strip().getAttribute("data-position")) ?? "").split(":").map(Number);
    const seconds = await player.evaluate(() => Number(document.querySelector("audio")?.currentTime ?? NaN));
    await player.getByRole("button", { name: "Pause", exact: true }).click();
    if (!(bar >= 2)) throw new Error(`bar ${bar} after ~2.6 s (audio at ${seconds})`);
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
