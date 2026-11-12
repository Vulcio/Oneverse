// Slower or faster in the same key (issue #139): the stem player resamples
// each part (its playbackRate) and puts it back in its key with the stretch
// nodes. The mix is recorded in the page (a test tap) and measured: at 80%
// a 440 Hz part is still 440 Hz, the drums' clicks 1/0.8 s apart instead of
// 1 s, the position 80% of the time played; the click stem is silent (the
// metronome stands in for it) and recording waits for 100%.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { API, WEB, api, finish, settledFiles, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Slower");
const RATE = 48000;

/** A mono 16-bit WAV of `seconds`, silent but for `fill(i)`. */
function wav(seconds, fill) {
  const samples = new Int16Array(RATE * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(fill(i / RATE) * 20000);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length * 2, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer)]);
}
// A held A (440 Hz) from 1 s to 3 s; a 3 kHz click at 1 s and 2 s (the drums).
// A held A (440 Hz) from 1 s to 3 s; the drums' 3 kHz click at 1 s and 2 s; the click stem's 1.5 kHz beeps every half second.
const tone = wav(4, (t) => (t >= 1 && t < 3 ? 0.5 * Math.sin(2 * Math.PI * 440 * t) : 0));
const clicks = wav(4, (t) => ((t >= 1 && t < 1.01) || (t >= 2 && t < 2.01) ? 0.8 * Math.sin(2 * Math.PI * 3000 * t) : 0));
const beeps = wav(4, (t) => (t % 0.5 < 0.02 ? 0.8 * Math.sin(2 * Math.PI * 1500 * t) : 0));

const song = await api(me, "POST", "/song-versions", { title: `Slowed ${stamp}`, language: "en", artists: ["Someone"], content: "[A]Hold\n", contentFormat: "CHORDPRO", key: "A", tempo: 120 });
for (const [name, bytes, part] of [
  ["Hold - Other.wav", tone, "OTHER"],
  ["Hold - Drums.wav", clicks, "DRUMS"],
  ["Hold - Click.wav", beeps, "CLICK"],
]) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", part);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), name);
  await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
}
// Made Opus by the Worker, as a 48 kHz WAV is (issue #182).
await settledFiles(me, song.id);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.songverseStems = { starts: [], tap: true };
  localStorage.setItem("songverse.mode", "practice");
});
await signIn(page, me);
const player = () => page.getByTestId("stem-player");

/** The player expanded (issue #182: it opens minimised). */
async function expandPlayer() {
  await page.getByTestId("stem-player").waitFor();
  const button = page.getByTestId("stem-player").getByRole("button", { name: "Expand the player" });
  if (await button.isVisible()) await button.click();
  await page.locator('[data-testid="stem-player"][data-view="expanded"]').waitFor();
}

/** Plays from the start and records the mix for `seconds`: its samples (48 kHz, mono), and where the player says it got to. */
async function recordMix(seconds) {
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await player().getByRole("slider", { name: "Position" }).fill("0");
  const { base64, position } = await page.evaluate(async (ms) => {
    const recorder = new MediaRecorder(window.songverseStems.stream);
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    document.querySelector('[data-testid="stem-play"]').click();
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, ms));
    const position = Number(document.querySelector('[data-testid="stem-playhead"]').value);
    const elapsed = (performance.now() - started) / 1000;
    document.querySelector('[data-testid="stem-play"]').click();
    recorder.stop();
    await done;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return { base64: btoa(text), position: { at: position, elapsed } };
  }, seconds * 1000);
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", String(RATE), "pipe:1"], { input: Buffer.from(base64, "base64"), maxBuffer: 64 * 1024 * 1024 });
  return { samples: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2), position };
}

/** When something first sounds after `from` (s), and its frequency over the next `span` s by zero crossings. */
function measure(samples, from = 0) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const onset = samples.findIndex((value, i) => i >= from * RATE && Math.abs(value) > peak * 0.2);
  return onset / RATE;
}
function frequency(samples, start, span = 0.4) {
  let crossings = 0;
  const a = Math.round(start * RATE);
  const b = Math.round((start + span) * RATE);
  for (let i = a + 1; i < b; i++) if (samples[i - 1] < 0 !== samples[i] < 0) crossings++;
  return crossings / 2 / span;
}
/**
 * Where the A starts after `from` (s): the first 10 ms where 440 Hz is half as loud as it gets. Slowed, the
 * metronome stands in for the click stem in the same mix (issue #448), so the first sound is its click, not the A.
 */
function toneStart(samples, from = 0) {
  const window = RATE / 100;
  const levels = [];
  for (let s = Math.round(from * RATE); s + window < samples.length; s += window) levels.push(band(samples, 440, s, window));
  const loudest = Math.max(...levels);
  return from + (levels.findIndex((value) => value > loudest * 0.5) * window) / RATE;
}
/** The tone's frequency (Hz) over `span` s from `start`: the strongest between 300 and 600 Hz, by correlation, so the metronome's clicks (above 600 Hz) don't count. */
function pitchOf(samples, start, span = 0.4) {
  let best = { f: 0, level: 0 };
  for (let f = 300; f <= 600; f += 0.5) {
    const level = band(samples, f, Math.round(start * RATE), Math.round(span * RATE));
    if (level > best.level) best = { f, level };
  }
  return best.f;
}
/** How much of `frequency` there is in `length` samples from `at`. */
function band(samples, frequency, at, length) {
  let re = 0;
  let im = 0;
  for (let k = 0; k < length; k++) {
    const phase = (2 * Math.PI * frequency * k) / RATE;
    re += samples[at + k] * Math.cos(phase);
    im += samples[at + k] * Math.sin(phase);
  }
  return Math.hypot(re, im) / length;
}
/** How loud the tone is over 0.6 s from `start`, and how much that moves (%, in 20 ms windows): a wobble. */
function loudness(samples, start) {
  const window = RATE / 50;
  const levels = [];
  for (let s = Math.round(start * RATE); s + window < (start + 0.6) * RATE; s += window) {
    let energy = 0;
    for (let i = s; i < s + window; i++) energy += samples[i] ** 2;
    levels.push(Math.sqrt(energy / window));
  }
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  const sd = Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
  return { mean, wobble: (100 * sd) / mean };
}

/** The loudest the 3 kHz click is, in the window around `at` (s): a band-pass by correlation. */
function clickAt(samples, near) {
  let best = { at: 0, level: 0 };
  const period = RATE / 3000;
  for (let i = Math.round((near - 0.4) * RATE); i < (near + 0.4) * RATE; i += 24) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < 240; k++) {
      const phase = (2 * Math.PI * k) / period;
      re += samples[i + k] * Math.cos(phase);
      im += samples[i + k] * Math.sin(phase);
    }
    const level = Math.hypot(re, im);
    if (level > best.level) best = { at: i / RATE, level };
  }
  return best.at;
}

/** How loud a frequency is over `span` s from `start` (a band-pass by correlation), for whether the click stem's beeps are heard. */
function level(samples, frequency, start, span) {
  let total = 0;
  const period = RATE / frequency;
  for (let i = Math.round(start * RATE); i < (start + span) * RATE; i += 240) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < 240; k++) {
      const phase = (2 * Math.PI * k) / period;
      re += samples[i + k] * Math.cos(phase);
      im += samples[i + k] * Math.sin(phase);
    }
    total = Math.max(total, Math.hypot(re, im));
  }
  return total;
}

let plain;
await step("at 100%: the A at 440 Hz, the drums' clicks 1 s apart, the click stem heard", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await expandPlayer();
  const label = await player().getByTestId("stem-speed-label").textContent();
  if (label !== "100%") throw new Error(label);
  plain = await recordMix(3.6);
  const { samples } = plain;
  // The click stem's first beep is the recording's 0:00; the A measured between its beeps.
  const zero = measure(samples);
  const f = frequency(samples, zero + 1.55);
  if (Math.abs(f - 440) > 440 * 0.02) throw new Error(`${f} Hz`);
  const first = clickAt(samples, zero + 1);
  const gap = clickAt(samples, first + 1) - first;
  if (Math.abs(gap - 1) > 0.02) throw new Error(`clicks ${gap.toFixed(3)} s apart`);
  if (level(samples, 1500, 0.1, 0.6) < 1e5) throw new Error("the click stem not heard");
});

await step("at 80%: still an A (440 Hz), the clicks 1.25 s apart, the position 80% of the time; the click stem silent", async () => {
  for (let i = 0; i < 4; i++) await player().getByTestId("stem-speed-down").click();
  await player().locator('[data-testid="stem-speed"][data-speed="0.8"]').waitFor();
  if ((await player().getByTestId("stem-speed-label").textContent()) !== "80%") throw new Error("not 80%");
  const { samples, position } = await recordMix(4.2);
  const start = toneStart(samples);
  const f = pitchOf(samples, start + 0.3);
  if (Math.abs(f - 440) > 440 * 0.02) throw new Error(`${f} Hz: the key moved`);
  const first = clickAt(samples, start);
  const gap = clickAt(samples, first + 1.25) - first;
  if (Math.abs(gap - 1.25) > 0.02) throw new Error(`clicks ${gap.toFixed(3)} s apart`);
  const ratio = position.at / position.elapsed;
  if (Math.abs(ratio - 0.8) > 0.08) throw new Error(`the playhead at ${position.at}s after ${position.elapsed.toFixed(2)}s`);
  const beeps = level(samples, 1500, 0.1, 0.6);
  const heard = level(plain.samples, 1500, 0.1, 0.6);
  if (beeps > heard * 0.1) throw new Error(`the click stem heard: ${beeps.toFixed(0)} (at 100% ${heard.toFixed(0)})`);
  // Every part put back in its key, the drums too: through a stretch node.
  const stretch = await page.evaluate(() => window.songverseStems.stretch);
  if (!stretch?.some((node) => node.shift !== null && Math.abs(node.shift - 3.863) < 0.01)) throw new Error(JSON.stringify(stretch));
});

await step("while slowed: recording waits for 100%; the compact player shows 80%", async () => {
  const record = player().getByTestId("stem-record");
  if (!(await record.isDisabled())) throw new Error("recording while slowed");
  if ((await record.getAttribute("title")) !== "Set the speed back to 100% to record") throw new Error(await record.getAttribute("title"));
  await player().getByTestId("stem-minimize").click();
  if ((await player().getByTestId("stem-speed-badge").textContent()) !== "80%") throw new Error("no badge");
  await player().getByRole("button", { name: "Expand the player" }).click();
});

await step("remembered for the song; the percentage back to 100%, and the stretch nodes stopped", async () => {
  await page.reload();
  await expandPlayer();
  await player().locator('[data-testid="stem-speed"][data-speed="0.8"]').waitFor();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await player().getByTestId("stem-speed-label").click();
  await player().locator('[data-testid="stem-speed"][data-speed="1"]').waitFor();
  await page.waitForFunction(() => (window.songverseStems.stretch ?? []).every((node) => node.shift === null));
  if (await player().getByTestId("stem-record").isDisabled()) throw new Error("recording still off");
  const stored = await page.evaluate((id) => localStorage.getItem(`songverse.stems.speed.${id}`), song.id);
  if (stored !== null) throw new Error(`still stored: ${stored}`);
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join("\n"));
});

await browser.close();
finish();
