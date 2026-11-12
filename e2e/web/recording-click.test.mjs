// The metronome locked to the recording (issue #448): with the stems playing and Click with the recording on,
// each click is scheduled on the stems' own audio clock, on the recording's beats when it has a beat map - here a
// band that slows down, which a steady grid would leave behind - and its 1 can be moved by hand (Move the 1 on
// the Audio tab), the detected beats kept.
import { chromium } from "playwright";
import { API, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

/** Thirty seconds of a quiet tone, as a WAV (8 kHz, 16-bit, mono). */
function wav(frequency, seconds = 30, rate = 8000) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 2000), 44 + i * 2);
  return buffer;
}

let page;
const step = stepper(() => page);
const me = await user("Click player");
const song = await api(me, "POST", "/song-versions", { title: `Click ${stamp}`, language: "en", artists: ["Band"], tempo: 100, content: "[G]Line\n", contentFormat: "CHORDPRO" });
const form = new FormData();
form.append("type", "AUDIO");
form.append("stemPart", "DRUMS");
form.append("file", new Blob([wav(220)], { type: "audio/wav" }), "Drums.wav");
const file = await (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form })).json();
// The recording: 100 BPM slowing down (each beat 0.8 ms longer than the one before), its first beat 0.6 s in, bars of four.
const beats = Array.from({ length: 44 }, (_, i) => Math.round((0.6 + i * 0.6 + i * i * 0.0004) * 1000) / 1000);
const downbeats = beats.filter((_, i) => i % 4 === 0);
await api(me, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { recordingTempo: 100, recordingFirstBeat: 0.6, recordingTimeSignature: "4/4" });
sql(`update "Attachment" set "recordingBeats" = '{${beats.join(",")}}', "recordingDownbeats" = '{${downbeats.join(",")}}' where id = '${file.id}'`);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const player = () => page.getByTestId("stem-player");
  /** The clicks scheduled with the recording since `since` (device clock, ms). */
  async function clicksSince(since, count) {
    await page.waitForFunction(([s, n]) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.heardAt > s && c.recording !== undefined).length >= n, [since, count], { timeout: 20000 });
    return page.evaluate((s) => window.songverseMetronome.clicks.filter((c) => c.heardAt > s && c.recording !== undefined), since);
  }

  await step("on the recording's beats, as the band slows down: within a few ms, on the stems' own clock", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
    await player().getByRole("button", { name: "Expand the player" }).click();
    await player().getByRole("slider", { name: "Position" }).fill("12");
    await page.getByTestId("stem-click").click();
    const since = Date.now();
    await page.getByTestId("stem-play").click();
    const clicks = await clicksSince(since, 8);
    const start = await page.evaluate(() => window.songverseStems.starts.at(-1));
    // Bar 1 is position 4 (a bar from 0:00 before the first beat): beat n of the recording is position n + 4.
    const onBeat = clicks.filter((c) => Number.isInteger(c.position) && c.position - 4 >= 1 && c.position - 4 < beats.length - 1);
    if (onBeat.length < 6) throw new Error(`${onBeat.length} clicks on the map's beats`);
    const worst = Math.max(...onBeat.map((c) => Math.abs(c.recording - beats[c.position - 4]) * 1000));
    check("each click on the recording's beat (ms off, at most)", worst < 2, `${worst.toFixed(2)} ms`);
    // A steady grid at the starting tempo would be far behind by then.
    const steady = Math.max(...onBeat.map((c) => Math.abs(0.6 + (c.position - 4) * 0.6 - beats[c.position - 4]) * 1000));
    check("where a steady grid would be (ms off)", steady > 30, `${steady.toFixed(0)} ms`);
    // Heard as the stems are: the recording's time of each click, from their 0:00 on the same clock.
    const apart = Math.max(...onBeat.map((c) => Math.abs(c.heardAt - (start.zeroAt + c.recording * 1000))));
    check("each click where the stems say that moment of the recording is heard (ms apart, at most)", apart < 1, `${apart.toFixed(3)} ms`);
    await page.getByTestId("stem-play").click();
  });

  await step("Move the 1 a beat later on the Audio tab: the bars move, the beats stay", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=audio`);
    const move = page.getByTestId("recording-move-one").first();
    await move.waitFor({ timeout: 15000 });
    await move.getByRole("button", { name: "Move the 1 a beat later" }).click();
    let moved = null;
    for (let i = 0; i < 30 && !moved; i++) {
      const files = await api(me, "GET", `/song-versions/${song.id}/attachments`);
      const one = files.find((f) => f.id === file.id);
      if (one.recordingFirstBeat === beats[1]) moved = one;
      else await page.waitForTimeout(200);
    }
    if (!moved) throw new Error("the first beat didn't move");
    check("the bars a beat later, on the same beats", JSON.stringify(moved.recordingDownbeats.slice(0, 2)) === JSON.stringify([beats[1], beats[5]]), JSON.stringify(moved.recordingDownbeats.slice(0, 2)));
    check("the beats kept, from the new first beat", moved.recordingBeats.length === beats.length - 1 && moved.recordingBeats[0] === beats[1], `${moved.recordingBeats.length} beats from ${moved.recordingBeats[0]}`);
  });

  await step("and 10 ms later: every beat moves", async () => {
    const before = (await api(me, "GET", `/song-versions/${song.id}/attachments`)).find((f) => f.id === file.id);
    const after = await api(me, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { recordingBeatShift: { seconds: 0.01 } });
    check("the first beat 10 ms later", Math.abs(after.recordingFirstBeat - before.recordingFirstBeat - 0.01) < 1e-6, `${before.recordingFirstBeat} → ${after.recordingFirstBeat}`);
    check("every beat 10 ms later", after.recordingBeats.every((t, i) => Math.abs(t - before.recordingBeats[i] - 0.01) < 1e-6), "");
  });
} finally {
  await browser.close();
}
finish();
