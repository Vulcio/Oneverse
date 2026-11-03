// The tuner (issue #3), in the browser: Chromium's fake microphone plays a
// recorded A2 ten cents flat, on a loop, and the page reads it - the note,
// the cents, the guitar's A string lit - through each display; the concert
// pitch moves the reading, the settings stay on the device, and Stop lets
// the microphone go. The engine's latest reading is on window.songverseTuner.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { SP, WEB, finish, signIn, stepper, user } from "../lib/harness.mjs";

/** A plucked-string-ish tone: a fundamental and a few harmonics, 16-bit mono. */
function toneWav(file, hz, seconds = 4, rate = 48000) {
  const count = seconds * rate;
  const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const v = 0.5 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t) + 0.12 * Math.sin(6 * Math.PI * hz * t);
    data.writeInt16LE(Math.round(v * 0.8 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

const flatA2 = 110 * 2 ** (-10 / 1200);
const wav = path.join(SP, "tuner-a2-flat.wav");
toneWav(wav, flatA2);

let page;
const step = stepper(() => page);
const me = await user("Guitarist");
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
page = await context.newPage();
await signIn(page, me);

/** Waits for a live reading that `test` accepts, and returns it. */
async function reading(test, timeout = 15000) {
  // The page's CSP refuses eval, so the test is a midi and a cents window.
  const handle = await page.waitForFunction(
    ({ midi, cents, within }) => {
      const r = window.songverseTuner;
      return r && r.live && (midi === undefined || r.midi === midi) && (cents === undefined || Math.abs(r.cents - cents) < within) ? r : null;
    },
    { within: 1, ...test },
    { timeout },
  );
  return handle.jsonValue();
}

await step("the Tuner page, from the sidebar: it waits for Start, saying the microphone is used only while it listens", async () => {
  await page.getByRole("link", { name: "Tuner", exact: true }).first().click();
  await page.waitForURL(`${WEB}/tuner`);
  await page.getByTestId("tuner-status").getByText("nothing leaves your device").waitFor();
  if ((await page.getByTestId("tuner-note").textContent()) !== "—") throw new Error("a note before listening");
});

await step("Start: it hears A2, ten cents flat", async () => {
  await page.getByTestId("tuner-start").click();
  const r = await reading({ midi: 45, cents: -10 });
  if (Math.abs(r.hz - flatA2) > 0.2) throw new Error(`${r.hz} Hz`);
  await page.locator('[data-testid="tuner-readout"][data-note="A2"]').waitFor();
  await page.getByTestId("tuner-cents").getByText(/^-(9\.\d|10\.\d)¢$/).waitFor();
  await page.getByTestId("tuner-status").getByText("Listening").waitFor();
  await page.getByRole("button", { name: "Stop" }).waitFor();
});

await step("a guitar in standard tuning: its A string is the one lit", async () => {
  await page.getByTestId("tuner-instrument").click();
  await page.getByRole("option", { name: "Guitar" }).click();
  const strings = page.getByTestId("tuner-string");
  if ((await strings.count()) !== 6) throw new Error(`${await strings.count()} strings`);
  await strings.nth(1).and(page.locator('[data-active="true"]')).waitFor();
  if ((await page.locator('[data-testid="tuner-string"][data-active="true"]').count()) !== 1) throw new Error("more than one lit");
  // Drop D keeps A where it was; its low string is now D.
  await page.getByTestId("tuner-tuning").click();
  await page.getByRole("option", { name: /^Drop D/ }).click();
  await strings.first().getByText("D", { exact: true }).waitFor();
  await strings.nth(1).and(page.locator('[data-active="true"]')).waitFor();
});

await step("each display draws the note: strobe, wheel, needle, spectrum", async () => {
  for (const [tab, id] of [
    ["wheel", "tuner-wheel"],
    ["needle", "tuner-needle"],
    ["spectrum", "tuner-spectrum"],
    ["strobe", "tuner-strobe"],
  ]) {
    await page.getByTestId(`tuner-display-${tab}`).click();
    await page.getByTestId(id).waitFor();
  }
});

await step("concert pitch at 435 Hz: the same note now reads about ten cents sharp", async () => {
  await page.getByTestId("tuner-settings-pitch").click();
  await page.getByRole("button", { name: "435", exact: true }).click();
  await page.getByTestId("tuner-a4").getByText("A4 = 435 Hz").waitFor();
  await reading({ midi: 45, cents: 9.9 });
  await page.getByRole("button", { name: "Raise concert pitch" }).click();
  if ((await page.getByTestId("tuner-a4-input").inputValue()) !== "436") throw new Error(await page.getByTestId("tuner-a4-input").inputValue());
});

await step("the microphone tab: sensitivity and detector; YIN hears the same note", async () => {
  await page.getByTestId("tuner-settings-microphone").click();
  await page.getByTestId("tuner-sensitivity").getByRole("button", { name: "High" }).click();
  await page.getByTestId("tuner-detector").getByRole("button", { name: "YIN" }).click();
  await page.getByText("holds on better in a noisy room").waitFor();
  await reading({ midi: 45 });
});

await step("a temperament from a key: just intonation in F moves A, F's major third", async () => {
  await page.getByTestId("tuner-settings-pitch").click();
  await page.getByRole("button", { name: "440", exact: true }).click();
  await page.getByTestId("tuner-temperament").click();
  await page.getByRole("option", { name: "Just intonation" }).click();
  await page.getByTestId("tuner-key").click();
  await page.getByRole("option", { name: "F", exact: true }).click();
  // A pure major third is 13.7 cents under the equal one, so A2 ten cents flat reads +3.7.
  await reading({ midi: 45, cents: 3.7 });
});

await step("Stop lets the microphone go; the settings are still there after a reload", async () => {
  await page.getByTestId("tuner-start").click();
  await page.getByTestId("tuner-status").getByText("nothing leaves your device").waitFor();
  const live = await page.evaluate(() => window.songverseTuner);
  if (live) throw new Error("still a reading after Stop");
  await page.reload();
  await page.getByTestId("tuner-instrument").getByText("Guitar").waitFor();
  await page.getByTestId("tuner-tuning").getByText("Drop D").waitFor();
  await page.getByTestId("tuner-temperament").getByText("Just intonation").waitFor();
  await page.getByTestId("tuner-display-strobe").and(page.locator("[data-active], [aria-selected='true']")).waitFor();
});

await step("on a phone, the settings are in their tabs, all reachable", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("tuner-settings-microphone").click();
  const high = page.getByTestId("tuner-sensitivity").getByRole("button", { name: "High" });
  await high.scrollIntoViewIfNeeded();
  if (!(await high.isVisible())) throw new Error("sensitivity hidden");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  if (width > 390) throw new Error(`page ${width}px wide`);
});

await browser.close();
finish();
