// Autoscroll (issue #414): in Practice as in Live, its own button (not Play), paced by the song's
// bars and stretched to its duration when it has one - "~" the length worked out from the tempo
// when it hasn't - and following the music (the metronome here) while it plays.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Autoscroll");
const verses = Array.from({ length: 40 }, (_, i) => `[G]Line ${i + 1} of the [C]song and [D]on it goes`).join("\n");
const content = `{start_of_verse}\n${verses}\n{end_of_verse}\n`;
// Ten seconds long: it reaches its end within the test.
const timed = await api(me, "POST", "/song-versions", { title: `Timed ${stamp}`, language: "en", artists: ["Band"], key: "G", tempo: 100, durationSeconds: 10, content, contentFormat: "CHORDPRO" });
// No duration: its length from its bars - 40 lines of 3 chords, 3 bars each, 4 beats at 120 BPM: 4 minutes.
const untimed = await api(me, "POST", "/song-versions", { title: `Untimed ${stamp}`, language: "en", artists: ["Band"], key: "G", tempo: 120, content, contentFormat: "CHORDPRO" });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
const scrollY = () => page.evaluate(() => window.scrollY);
const bottom = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
const control = () => page.getByTestId("practice-autoscroll");

await step("Practice: the song's length, its own icon, not Play", async () => {
  await page.goto(`${WEB}/library/${timed.id}`);
  await page.waitForLoadState("networkidle");
  if ((await page.getByTestId("practice-length").innerText()).trim() !== "0:10") throw new Error(await page.getByTestId("practice-length").innerText());
  await control().getByRole("button", { name: "Start scrolling" }).waitFor();
  if (!(await control().locator("svg.lucide-chevrons-down").count())) throw new Error("not the autoscroll icon");
  if (await control().locator("svg.lucide-play").count()) throw new Error("a Play icon");
});

await step("it goes through the song in its duration, line by line, then stops", async () => {
  const start = Date.now();
  await control().getByRole("button", { name: "Start scrolling" }).click();
  await control().getByRole("button", { name: "Pause scrolling" }).waitFor();
  await control().getByText("100%").waitFor();
  await page.waitForTimeout(4000);
  const partway = await scrollY();
  if (partway <= 0 || partway >= (await bottom()) - 2) throw new Error(`after 4s of 10: ${partway} of ${await bottom()}`);
  // Line 20 of 40, at 5s: about a third of the way down what's seen.
  await page.waitForTimeout(1000 - (Date.now() - start - 4000));
  const line = await page.locator("[data-line-id]", { hasText: "Line 20 of" }).first().evaluate((el) => el.getBoundingClientRect().top / window.innerHeight);
  if (line < 0.15 || line > 0.55) throw new Error(`line 20 at ${line} of the screen at 5s`);
  await control().getByRole("button", { name: "Start scrolling" }).waitFor({ timeout: 10000 });
  const took = (Date.now() - start) / 1000;
  if (took < 8 || took > 13) throw new Error(`ended after ${took}s`);
  if ((await scrollY()) < (await bottom()) - 2) throw new Error("not at the end");
});

await step("slower and faster while it runs; paused, it stays", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await control().getByRole("button", { name: "Start scrolling" }).click();
  await control().getByRole("button", { name: "Faster" }).click();
  await control().getByText("110%").waitFor();
  await control().getByRole("button", { name: "Pause scrolling" }).click();
  const paused = await scrollY();
  await page.waitForTimeout(500);
  if ((await scrollY()) !== paused) throw new Error("still scrolling after pausing");
});

await step("no duration: the length worked out from the tempo, marked as a guess", async () => {
  await page.goto(`${WEB}/library/${untimed.id}`);
  await page.waitForLoadState("networkidle");
  const length = page.getByTestId("practice-length");
  if ((await length.innerText()).trim() !== "~4:00") throw new Error(await length.innerText());
  if (!(await length.getAttribute("title"))?.includes("tempo")) throw new Error("no hint");
});

await step("with the metronome playing, it follows the music", async () => {
  await page.getByTestId("practice-metronome").click();
  await page.locator('[data-testid="practice-metronome"][aria-pressed="true"]').waitFor();
  await control().getByRole("button", { name: "Start scrolling" }).click();
  await control().getByText("With the music").waitFor();
  // Slower and faster are the music's: not there.
  if (await control().getByRole("button", { name: "Faster" }).count()) throw new Error("a speed while following");
  // The metronome counts in, then the page goes on with its beats.
  await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 15000 });
  // Stopped: its own clock again.
  await page.getByTestId("practice-metronome").click();
  await control().getByText("100%").waitFor();
  await control().getByRole("button", { name: "Pause scrolling" }).click();
});

await step("Live: the same icon, no Play", async () => {
  await page.goto(`${WEB}/library/${untimed.id}/live`);
  await page.getByTestId("live-view").waitFor();
  const button = page.getByRole("button", { name: "Start scrolling" });
  await button.waitFor();
  if (!(await button.locator("svg.lucide-chevrons-down").count()) || (await button.locator("svg.lucide-play").count())) throw new Error("not the autoscroll icon");
  if (!(await page.getByTestId("live-details").innerText()).includes("~4:00")) throw new Error(await page.getByTestId("live-details").innerText());
});

await browser.close();
finish();
