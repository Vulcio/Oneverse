// Stored waveforms in the player (issue #388): while a part downloads, its
// waveform - the server's, worked out once - is drawn at once, faint, and
// fills in as its bytes arrive; once decoded it's drawn as it plays. Here
// one part's download is held back, to see it waiting.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { API, WEB, api, finish, settledFiles, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Waveform listener");

/** Eight seconds of a tone swelling and fading, so its waveform has a shape: Ogg Opus, stereo, as Songverse stores stems. */
const opus = (frequency, swell) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=8`, "-af", `volume='0.1+0.9*abs(sin(PI*t*${swell}))':eval=frame`, "-ac", "2", "-c:a", "libopus", "-b:a", "96k", "-f", "ogg", "pipe:1"]);

const song = await api(me, "POST", "/song-versions", { title: `Waveforms ${stamp}`, language: "en", artists: ["Band"], content: "[G]Line\n", contentFormat: "CHORDPRO" });
for (const [name, part, frequency, swell] of [["Waves - Bass.opus", "BASS", 110 + (stamp % 50), 0.5], ["Waves - Keys.opus", "KEYS", 440 + (stamp % 50), 1.3]]) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", part);
  form.append("file", new Blob([opus(frequency, swell)], { type: "audio/ogg" }), name);
  await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
}
const files = await settledFiles(me, song.id);
const keys = files.find((file) => file.stemPart === "KEYS");
// The Worker's a moment behind the uploads.
for (let i = 0; i < 120 && (await api(me, "GET", `/song-versions/${song.id}/attachments/waveforms`)).length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 500));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const player = () => page.getByTestId("stem-player");
  const part = (name) => player().getByTestId("stem-track").filter({ hasText: name }).getByTestId("stem-waveform");

  // The keys' download waits until it's let go.
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  await page.route(`${API}/song-versions/${song.id}/attachments/${keys.id}/download`, async (route) => {
    await held;
    await route.continue();
  });

  await step("before its audio arrives, a part's stored waveform is drawn, waiting to fill in", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await player().getByRole("button", { name: "Expand the player" }).click();
    await part("Keys").waitFor();
    const waiting = await part("Keys").getAttribute("data-loading");
    if (waiting === null) throw new Error("drawn as if it played");
    const drawn = await part("Keys").locator("path").first().getAttribute("d");
    if (!drawn || drawn.length < 100) throw new Error(`no shape: ${drawn}`);
    // The other part arrives and is drawn as it plays.
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll('[data-testid="stem-track"]')].find((el) => el.textContent?.includes("Bass"));
      const wave = row?.querySelector('[data-testid="stem-waveform"]');
      return wave && !wave.hasAttribute("data-loading");
    });
    if ((await player().getAttribute("data-state")) === "ready") throw new Error("ready before every part arrived");
  });

  await step("in Tracks too: its lane drawn from the stored waveform, waiting", async () => {
    await page.getByTestId("chart-view-tracks").click();
    const lane = page.getByTestId("tracks-view").getByTestId("tracks-lane").filter({ hasText: "Keys" });
    await lane.waitFor();
    if ((await lane.getAttribute("data-ready")) !== "false") throw new Error("ready before it arrived");
    // Something drawn on its canvas: the waveform, before the audio.
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll('[data-testid="tracks-lane"]')].find((el) => el.textContent?.includes("keys"));
      const canvas = row?.querySelector("canvas");
      const context = canvas?.getContext("2d");
      if (!canvas || !context || !canvas.width) return false;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    });
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/waiting.png` });
  });

  await step("once it's arrived, it's drawn as the others", async () => {
    release();
    await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="stem-waveform"][data-loading]'));
    await page.getByTestId("tracks-view").getByTestId("tracks-lane").filter({ hasText: "Keys" }).and(page.locator('[data-ready="true"]')).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/arrived.png` });
  });
} finally {
  await browser.close();
}
finish();
