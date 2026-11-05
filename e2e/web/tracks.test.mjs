// The Tracks view (issue #374): a song's parts as lanes, as in a DAW, beside Chart and Grid - the sections across the
// top with a box round what's shown, the words being sung, a lane per part under a playhead in the middle, zoomed in
// and out, steady as it scrolls, thin lines or a filled shape, a part muted from its lane, a tap on the overview to go there. Screenshots go to e2e/.artifacts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, SP, WEB, api, call, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems");

let page;
const step = stepper(() => page);
const me = await user("Lanes");
const song = await api(me, "POST", "/song-versions", {
  title: `Lanes ${stamp}`,
  language: "en",
  artists: [`Band ${stamp}`],
  tempo: 120,
  timeSignature: "4/4",
  content:
    "{start_of_verse}\n[G]Morning has [C]broken\n[G]Like the first [D]morning\n{end_of_verse}\n{start_of_chorus}\n[C]Blackbird has [G]spoken\n[D]Like the first [G]bird\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
const [verse, chorus] = (await api(me, "GET", `/song-versions/${song.id}`)).documentJson.sections.map((section) => section.id);
// The files are 20 s: the verse to 8 s, the chorus after.
const cuePoints = [
  { at: 0, sectionId: verse },
  { at: 8, sectionId: chorus },
];
for (const [name, part] of [["Morning Light - Vocals.opus", "VOCALS"], ["Morning Light - Bass.mp3", "BASS"]]) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", part);
  form.append("file", new Blob([readFileSync(path.join(FIXTURES, name))]), name);
  const file = await (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form })).json();
  await call(me, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { cuePoints });
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const player = () => page.getByTestId("stem-player");
  const view = () => page.getByTestId("tracks-view");
  const position = async () => Number(await player().getByTestId("stem-playhead").inputValue());

  await step("Tracks beside Chart and Grid: a lane per part, the sections across the top", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
    await page.getByTestId("chart-view-tracks").click();
    await page.locator('[data-testid="tracks-view"][data-state="ready"]').waitFor();
    const lanes = await view().getByTestId("tracks-lane").count();
    if (lanes !== 2) throw new Error(`${lanes} lanes`);
    const sections = await view().getByTestId("tracks-section").allInnerTexts();
    if (sections.join(" ") !== "V C") throw new Error(sections.join(" "));
    if ((await view().getAttribute("data-zoom")) !== "16") throw new Error(`zoom ${await view().getAttribute("data-zoom")}`);
  });

  await step("playing: the words being sung and the bar follow, the lanes scroll under the playhead", async () => {
    await player().getByTestId("stem-play").click();
    await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor();
    await view().getByTestId("tracks-sung").waitFor({ timeout: 8000 });
    const first = await view().getByTestId("tracks-sung").innerText();
    // 120 BPM, a line of two bars: the next one in about four seconds.
    await page.waitForFunction((was) => {
      const now = document.querySelector('[data-testid="tracks-sung"]')?.textContent;
      return now && now !== was;
    }, first, { timeout: 10000 });
    if (!/^Bar \d+$/.test(await page.getByTestId("tracks-bar").innerText())) throw new Error("no bar");
    await page.screenshot({ path: `${SP}/tracks-playing.png` });
  });

  await step("scrolling, a lane's waveform keeps its shape: it only slides, by whole pixels (issue #386)", async () => {
    // Two frames a few apart: the played half of the first lane, slid by some whole number of pixels, is the same picture.
    const seen = await view()
      .getByTestId("tracks-lane")
      .first()
      .locator("canvas")
      .evaluate(async (canvas) => {
        const context = canvas.getContext("2d");
        const { width, height } = canvas;
        const grab = () => context.getImageData(0, 0, width, height).data;
        const before = grab();
        for (let k = 0; k < 12; k++) await new Promise((done) => requestAnimationFrame(done));
        const after = grab();
        const right = Math.floor(width / 2) - 30;
        let best = { shift: -1, differ: Infinity, drawn: 0 };
        for (let shift = 0; shift <= 120; shift++) {
          let differ = 0, drawn = 0;
          for (let y = 0; y < height; y++)
            for (let x = 8; x < right - shift; x++) {
              const a = (y * width + x + shift) * 4, b = (y * width + x) * 4;
              if (after[b + 3] > 0) drawn++;
              if (Math.abs(before[a] - after[b]) + Math.abs(before[a + 1] - after[b + 1]) + Math.abs(before[a + 2] - after[b + 2]) + Math.abs(before[a + 3] - after[b + 3]) > 8) differ++;
            }
          if (differ < best.differ) best = { shift, differ, drawn };
        }
        return best;
      });
    if (seen.drawn < 200) throw new Error(`nothing drawn: ${JSON.stringify(seen)}`);
    if (seen.shift <= 0) throw new Error(`not scrolling: ${JSON.stringify(seen)}`);
    if (seen.differ > seen.drawn / 100) throw new Error(`the shape changed as it scrolled: ${JSON.stringify(seen)}`);
  });

  await step("zoomed out to the whole song, then in again", async () => {
    // 32 s is more than the song's 20: the whole song.
    await view().getByTestId("tracks-zoom-out").click();
    await page.locator('[data-testid="tracks-view"][data-zoom="song"]').waitFor();
    if (await view().getByTestId("tracks-window").isVisible()) throw new Error("a box round the whole song");
    await view().getByTestId("tracks-zoom-in").click();
    await page.locator('[data-testid="tracks-view"][data-zoom="16"]').waitFor();
  });

  await step("the waveforms are filled shapes, a colour per part; the toggle turns the colours off and back (issue #379)", async () => {
    // Pixels drawn with colour (not grey) in the first lane.
    const tinted = () =>
      view()
        .getByTestId("tracks-lane")
        .first()
        .locator("canvas")
        .evaluate((canvas) => {
          const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          let drawn = 0, coloured = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 40) continue;
            drawn++;
            if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 40) coloured++;
          }
          return { drawn, coloured };
        });
    const colours = view().getByTestId("tracks-colours");
    if ((await colours.getAttribute("aria-pressed")) !== "true") throw new Error("colours off by default");
    await page.waitForTimeout(300);
    let seen = await tinted();
    if (seen.drawn < 200 || seen.coloured < seen.drawn / 2) throw new Error(`coloured: ${JSON.stringify(seen)}`);
    await colours.click();
    await page.waitForTimeout(300);
    seen = await tinted();
    if (seen.drawn < 200 || seen.coloured > seen.drawn / 20) throw new Error(`grey: ${JSON.stringify(seen)}`);
    await colours.click();
    await page.locator('[data-testid="tracks-colours"][aria-pressed="true"]').waitFor();
  });

  await step("thin lines instead of the filled shape, kept on the device, and back (issue #386)", async () => {
    const lane = () => view().getByTestId("tracks-lane").first().locator("canvas");
    // Columns drawn: an x with something on the middle row. Lines leave a gap between columns; the shape doesn't.
    const gaps = () =>
      lane().evaluate((canvas) => {
        const { width, height } = canvas;
        const data = canvas.getContext("2d").getImageData(0, Math.floor(height / 2), width, 1).data;
        let drawn = 0, gaps = 0;
        for (let x = 1; x < width; x++) {
          const on = data[x * 4 + 3] > 40, was = data[(x - 1) * 4 + 3] > 40;
          if (on) drawn++;
          if (was && !on) gaps++;
        }
        return { drawn, gaps };
      });
    const toggle = view().getByTestId("tracks-lines");
    if ((await toggle.getAttribute("aria-pressed")) !== "false") throw new Error("thin lines by default");
    const filled = await gaps();
    await toggle.click();
    await page.locator('[data-testid="tracks-lines"][aria-pressed="true"]').waitFor();
    await page.waitForTimeout(300);
    const thin = await gaps();
    if (thin.drawn < 50 || thin.gaps < filled.gaps + 50) throw new Error(`lines: ${JSON.stringify({ filled, thin })}`);
    if ((await page.evaluate(() => localStorage.getItem("songverse.tracksWaves"))) !== "lines") throw new Error("not kept");
    await toggle.click();
    await page.locator('[data-testid="tracks-lines"][aria-pressed="false"]').waitFor();
  });

  await step("on a phone (issue #390): the bar count beside Chart / Grid / Tracks, the look in Display's Tracks section", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (await view().getByTestId("tracks-zoom-in").isVisible()) throw new Error("the zoom buttons above the lanes on a phone");
    const tabs = await page.getByTestId("chart-view").boundingBox();
    const bar = await page.getByTestId("tracks-bar").boundingBox();
    if (!tabs || !bar || Math.abs(bar.y + bar.height / 2 - (tabs.y + tabs.height / 2)) > 6 || bar.x < tabs.x + tabs.width) throw new Error(`the bar count isn't beside the switch: ${JSON.stringify({ tabs, bar })}`);
    await page.getByTestId("display-open").click();
    await page.getByTestId("display-panel").getByTestId("display-section").click();
    await page.getByTestId("display-section-tracks").click();
    await page.getByTestId("display-track-zoom-8").click();
    await page.locator('[data-testid="tracks-view"][data-zoom="8"]').waitFor();
    await page.getByTestId("display-track-zoom-16").click();
    await page.locator('[data-testid="tracks-view"][data-zoom="16"]').waitFor();
    await page.getByTestId("display-close").click();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("a part muted from its lane, and back", async () => {
    await view().getByTestId("tracks-lane").first().getByTestId("tracks-mute").click();
    await view().locator('[data-testid="tracks-lane"][data-audible="false"]').waitFor();
    await view().getByTestId("tracks-lane").first().getByTestId("tracks-mute").click();
    await view().locator('[data-testid="tracks-lane"][data-audible="false"]').waitFor({ state: "detached" });
  });

  await step("a tap on the overview's chorus goes there", async () => {
    await player().getByTestId("stem-play").click();
    await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor();
    const box = await view().getByTestId("tracks-overview").boundingBox();
    // Three quarters of 20 s.
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="stem-playhead"]')?.value) > 12, null, { timeout: 5000 });
    if (!((await position()) < 17)) throw new Error(`at ${await position()}`);
  });

  await step("kept for the song on this device: Tracks again after a reload; Chart leaves it", async () => {
    await page.reload();
    await page.locator('[data-testid="tracks-view"]').waitFor();
    await page.getByTestId("chart-view-chart").click();
    await view().waitFor({ state: "detached" });
    await page.getByTestId("practice-chart").waitFor();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
