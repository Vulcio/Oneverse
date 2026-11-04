// The Tracks view (issue #374): a song's parts as lanes, as in a DAW, beside Chart and Grid - the sections across the
// top with a box round what's shown, the words being sung, a lane per part under a playhead in the middle, zoomed in
// and out, a part muted from its lane, a tap on the overview to go there. Screenshots go to e2e/.artifacts.
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
    if (!/^Bar \d+$/.test(await view().getByTestId("tracks-bar").innerText())) throw new Error("no bar");
    await page.screenshot({ path: `${SP}/tracks-playing.png` });
  });

  await step("zoomed out to the whole song, then in again", async () => {
    // 32 s is more than the song's 20: the whole song.
    await view().getByTestId("tracks-zoom-out").click();
    await page.locator('[data-testid="tracks-view"][data-zoom="song"]').waitFor();
    if (await view().getByTestId("tracks-window").isVisible()) throw new Error("a box round the whole song");
    await view().getByTestId("tracks-zoom-in").click();
    await page.locator('[data-testid="tracks-view"][data-zoom="16"]').waitFor();
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
