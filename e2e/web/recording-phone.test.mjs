// Recording on a phone (issue #501): the part folded into one line once it's known (Change opens the choices), the
// click and Follow in reach, and while a take records the recorder's slim bar is all the dock shows - the chart gets
// the screen. Following the music can be turned off (here and in Display), and nothing else plays over a take.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems");

let page;
const step = stepper(() => page);
const me = await user("Phone recorder");
const content = `{start_of_verse}
[G]Morning has [C]broken, [D]like the first [G]morning
[Em]Blackbird has [A]spoken, [D]like the first [D7]bird
[G]Praise for the [C]singing, [G]praise for the [Em]morning
[A]Praise for them [D]springing [C]fresh from the [G]word
{end_of_verse}
`;
const song = await api(me, "POST", "/song-versions", { title: `Morning ${stamp}`, language: "en", artists: ["Traditional"], key: "G", tempo: 100, timeSignature: "3/4", content, contentFormat: "CHORDPRO" });
for (const [name, part] of [
  ["03 drums.mp3", "DRUMS"],
  ["Morning Light - Bass.mp3", "BASS"],
]) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", part);
  form.append("multitrackId", `mtphone${stamp}`.slice(0, 40));
  form.append("multitrackName", "Live");
  form.append("recordingTempo", "100");
  form.append("recordingTimeSignature", "3/4");
  form.append("file", new Blob([readFileSync(path.join(FIXTURES, name))], { type: "audio/mpeg" }), name);
  const res = await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  if (res.status !== 201) throw new Error(`upload ${res.status}: ${await res.text()}`);
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["microphone"] });
page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
const dialog = () => page.getByTestId("recorder");
const player = () => page.getByTestId("stem-player");

await step("into the song's multitrack, the part is picked: one line, Change opens the choices", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  const expand = page.getByRole("button", { name: "Expand" }).last();
  if (await expand.isVisible()) await expand.click();
  await player().getByTestId("stem-record").click();
  await page.locator('[data-testid="recorder"][data-phase="ready"][data-more="false"]').waitFor({ timeout: 15000 });
  const summary = await dialog().getByTestId("recorder-summary").innerText();
  if (summary !== "Lead vocal · Live · Whole song") throw new Error(summary);
  if (await dialog().getByTestId("part-kind").count()) throw new Error("the choices shown");
  await dialog().getByTestId("recorder-more").getByText("Change").click();
  await dialog().getByTestId("part-kind").waitFor();
  await dialog().getByTestId("recorder-more").click();
  await page.locator('[data-testid="recorder"][data-more="false"]').waitFor();
});

await step("the click and Follow, in reach before the take", async () => {
  const click = dialog().getByTestId("recorder-click");
  const before = await click.getAttribute("aria-pressed");
  await click.click();
  await page.waitForFunction((was) => document.querySelector('[data-testid="recorder-click"]')?.getAttribute("aria-pressed") !== was, before);
  await click.click();
  await page.waitForFunction((was) => document.querySelector('[data-testid="recorder-click"]')?.getAttribute("aria-pressed") === was, before);
  if ((await dialog().getByTestId("recorder-follow").getAttribute("aria-pressed")) !== "true") throw new Error("not following by default");
  await page.screenshot({ path: `${SP}/recording-phone-ready.png` });
});

await step("recording: the slim bar, the chart everywhere else; the sung line lit, then not once Follow is off", async () => {
  await dialog().getByTestId("recorder-start").click();
  await dialog().getByText(/Recording \d:\d\d/).waitFor({ timeout: 15000 });
  for (const id of ["recorder-status", "recorder-click", "recorder-follow", "recorder-stop"]) if (!(await dialog().getByTestId(id).isVisible())) throw new Error(`${id} not shown`);
  for (const id of ["stem-play", "stem-record", "stem-tab-mix", "recorder-summary", "practice-pills"]) if (await page.getByTestId(id).first().isVisible()) throw new Error(`${id} shown while recording`);
  // The dock leaves most of the screen to the chart.
  const top = (await player().boundingBox()).y;
  if (top < 844 * 0.6) throw new Error(`the dock starts at ${top} px`);
  // Nothing else plays over the take, and leaving the page would end it: another song waits for Stop, and says why.
  if (!(await player().getByTestId("stem-play").isDisabled())) throw new Error("the player's Play while recording");
  await page.locator('[data-slot="sidebar-trigger"]').first().click();
  await page.locator('[data-slot="sidebar"] a[href^="/library/"]').filter({ hasNotText: `Morning ${stamp}` }).first().click();
  await page.getByText("Recording: stop the take before playing anything else or leaving the page.").waitFor();
  if (!page.url().endsWith(`/library/${song.id}`)) throw new Error(`left for ${page.url()}`);
  await page.keyboard.press("Escape");
  if ((await dialog().getAttribute("data-phase")) !== "recording") throw new Error("the take stopped");
  await page.locator("[data-line][data-sung]").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SP}/recording-phone-recording.png` });
  await dialog().getByTestId("recorder-follow").click();
  await page.waitForFunction(() => !document.querySelector("[data-line][data-sung]"));
  // The click muted mid-take: the take goes on.
  await dialog().getByTestId("recorder-click").click();
  await page.waitForTimeout(600);
  if ((await dialog().getAttribute("data-phase")) !== "recording") throw new Error("the take stopped");
  await dialog().getByTestId("recorder-stop").click();
  await dialog().getByTestId("recorder-take").waitFor();
  // Done: the player plays again.
  if (await player().getByTestId("stem-play").isDisabled()) throw new Error("Play still off");
});

await step("Follow the music in Display: kept on the device, the same switch", async () => {
  await dialog().getByTestId("recorder-dismiss").click();
  await dialog().getByTestId("recorder-discard-close").click();
  await page.getByTestId("display-open").click();
  await page.getByTestId("display-section").click();
  await page.getByTestId("display-section-layout").click();
  // Turned off from the recorder: off here too.
  await page.locator('[data-testid="display-follow-off"][aria-pressed="true"]').waitFor();
  await page.getByTestId("display-follow-on").click();
  if ((await page.evaluate(() => localStorage.getItem("songverse.followMusic"))) !== "1") throw new Error("not kept");
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join("\n"));
});

await browser.close();
finish();
