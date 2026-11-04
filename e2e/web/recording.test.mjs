// Recording a part in the browser (issue #123): multitracks - parts recorded
// together, sharing a key, tempo, time signature and first beat - and the
// recorder, which starts a new one with the metronome only or adds a part
// to one, hearing its other parts. Chromium's fake microphone stands in
// for a real one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems");

let page;
const step = stepper(() => page);
const me = await user("Recorder");
const song = (title) => api(me, "POST", "/song-versions", { title, language: "en", artists: [`Band ${stamp}`], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO", tempo: 100, timeSignature: "4/4" });
const upload = async (songId, name, fields = {}, bytes = readFileSync(path.join(FIXTURES, name))) => {
  const form = new FormData();
  form.append("type", "AUDIO");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), name);
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const files = (songId) => api(me, "GET", `/song-versions/${songId}/attachments`);

// --- the API: a file's multitrack and what it was recorded in, on upload and after
const apiSong = await song(`Multitracks API ${stamp}`);
let r = await upload(apiSong.id, "03 drums.mp3", { stemPart: "DRUMS", multitrackId: "mtapi0000001", multitrackName: "Live", recordingTempo: "92.5", recordingTimeSignature: "6/8", recordingFirstBeat: "1.5", recordingKey: "Bb" });
check(
  "uploaded into a multitrack, with what it was recorded in",
  r.status === 201 && r.body.multitrackId === "mtapi0000001" && r.body.multitrackName === "Live" && r.body.recordingTempo === 92.5 && r.body.recordingTimeSignature === "6/8" && r.body.recordingFirstBeat === 1.5 && r.body.recordingKey === "Bb",
  JSON.stringify(r.body),
);
const live = r.body;
r = await upload(apiSong.id, "03 drums.mp3", { stemPart: "DRUMS", multitrackId: "no way" });
check("a multitrack id that isn't one is refused", r.status === 400 && r.body.message.some((m) => m.includes("multitrackId")), JSON.stringify(r.body));
r = await upload(apiSong.id, "03 drums.mp3", { recordingTimeSignature: "4/3" });
check("so is a time signature that isn't one", r.status === 400, JSON.stringify(r.body));
r = await upload(apiSong.id, "03 drums.mp3", { recordingTempo: "fast" });
check("and a tempo that isn't a number", r.status === 400 && r.body.message.includes("recordingTempo must be a number"), JSON.stringify(r.body));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${live.id}`, { multitrackName: "Live at home", recordingTimeSignature: "12/8" });
check("renamed, another time signature", r.status === 200 && r.body.multitrackName === "Live at home" && r.body.recordingTimeSignature === "12/8", JSON.stringify(r.body));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${live.id}`, { multitrackId: null, multitrackName: "" });
check("back among the song's original stems", r.status === 200 && r.body.multitrackId === null && r.body.multitrackName === null, JSON.stringify(r.body));

// --- the web app
const webSong = await song(`Recorded ${stamp}`);
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);
// The recording drawer (issue #365): the same from the song's page, Practice and the player.
const dialog = () => page.getByTestId("recorder");
/** All its choices shown (it shows only the take once recording starts). */
async function more() {
  if ((await dialog().getAttribute("data-more")) !== "true") await dialog().getByTestId("recorder-more").click();
  await page.locator('[data-testid="recorder"][data-more="true"]').waitFor();
}
/** The count-in, in the drawer's head: the beats left. */
const countIn = () => dialog().getByTestId("recorder-status").getByText(/^\d+ beats?$|^Count-in…$/);

/** The recorder's part (issue #131): a voice or an instrument, then which. */
async function pickPart(kind, which) {
  await dialog().getByTestId("part-kind").selectOption({ label: kind });
  await dialog().getByTestId(kind === "Voice" ? "part-voice" : "part-instrument").selectOption({ label: which });
}

/** Records a take of about `seconds` past the count-in, and keeps it. */
async function recordAndKeep(seconds) {
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-start").click();
  await dialog().getByText(/Recording \d:\d\d/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(seconds * 1000);
  await dialog().getByTestId("recorder-stop").click();
  await dialog().getByTestId("recorder-take").waitFor();
  // Heard back, nudged a little.
  await dialog().getByTestId("recorder-preview").click();
  await dialog().getByRole("button", { name: "Stop" }).first().waitFor();
  await more();
  await dialog().getByTestId("recorder-nudge").fill("12");
  await dialog().getByText("+12 ms").waitFor();
  await dialog().getByTestId("recorder-keep").click();
  await dialog().waitFor({ state: "detached", timeout: 15000 });
}

/** The song's files once the Worker has processed every take (issue #127). */
async function processedFiles(songId) {
  let all = [];
  for (let i = 0; i < 150; i++) {
    all = await files(songId);
    if (all.every((file) => file.processing !== "PENDING")) return all;
    await page.waitForTimeout(200);
  }
  throw new Error(`still processing: ${JSON.stringify(all.map((file) => [file.filename, file.processing]))}`);
}

/** A file's audio, decoded by ffmpeg: its length (s) and loudest sample. */
async function decoded(songId, file) {
  const res = await fetch(`${API}/song-versions/${songId}/attachments/${file.id}/download`, { headers: { Authorization: `Bearer ${me.bearer}` } });
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"], { input: Buffer.from(await res.arrayBuffer()), maxBuffer: 64 * 1024 * 1024 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return { seconds: samples.length / 48000, peak };
}

let first;
await step("the first layer, with the metronome only: a new multitrack at its own tempo and time signature", async () => {
  await page.goto(`${WEB}/library/${webSong.id}?tab=audio`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("record-new").click();
  await dialog().waitFor();
  if ((await dialog().getByTestId("recorder-target").inputValue()) !== "new") throw new Error("not into a new multitrack");
  await dialog().getByTestId("recorder-name").fill("Acoustic");
  await dialog().getByTestId("recorder-tempo").fill("90");
  await dialog().getByTestId("recorder-signature").selectOption("3/4");
  await pickPart("Instrument", "Guitar");
  await dialog().getByTestId("recorder-latency").getByText(/Delay taken off: \d+ ms \(the browser's estimate\)/).waitFor({ timeout: 15000 });
  // Clapping along with the clicks, to measure the delay with headphones: it listens, then says what it heard.
  await dialog().getByTestId("recorder-clap").click();
  await dialog().getByText("Listen to the clicks…").waitFor();
  await dialog().getByText(/Clap on each click: \d\/8/).waitFor({ timeout: 10000 });
  await dialog().getByTestId("recorder-latency").getByText(/Delay taken off: \d+ ms \((measured on this device|the browser's estimate)\)/).waitFor();
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="recorder-clap"]')?.disabled, null, { timeout: 15000 });
  await page.evaluate(() => {
    localStorage.removeItem("songverse.recorder.roundTrip");
    localStorage.removeItem("songverse.recorder.roundTrips");
  });
  // Evened out by default; the noise left alone unless asked.
  if (!(await dialog().getByTestId("recorder-level").isChecked()) || (await dialog().getByTestId("recorder-noise").isChecked())) throw new Error("processing options");
  // A bar of count-in (2 s at 90 BPM in 3/4) before the take's first beat.
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-start").click();
  await countIn().waitFor();
  // The take, drawn as it's recorded (the microphone left of the playhead).
  await dialog().getByTestId("take-strip").waitFor();
  await dialog().getByText(/Recording 0:0[1-9]/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await dialog().getByTestId("recorder-stop").click();
  await dialog().getByTestId("recorder-keep").click();
  await dialog().waitFor({ state: "detached", timeout: 15000 });
  [first] = await files(webSong.id);
  const ok =
    first?.stemPart === "GUITAR" &&
    /^mt[0-9a-f]{24}$/.test(first.multitrackId) &&
    first.multitrackName === "Acoustic" &&
    first.recordingTempo === 90 &&
    first.recordingTimeSignature === "3/4" &&
    first.recordingFirstBeat === 2 &&
    first.visibility === "PRIVATE";
  if (!ok) throw new Error(JSON.stringify(first));
});

await step("the Worker turns the take into Opus: from the multitrack's 0:00, count-in included", async () => {
  [first] = await processedFiles(webSong.id);
  if (first.mimeType !== "audio/ogg" || !first.filename.endsWith(".opus") || first.processing !== null) throw new Error(JSON.stringify(first));
  const { seconds, peak } = await decoded(webSong.id, first);
  // The count-in (2 s), a second or more recorded, and the time to stop - its
  // trailing silence trimmed back to the fake microphone's last beep.
  if (seconds < 2.5 || seconds > 8) throw new Error(`${seconds} s`);
  // The fake microphone's beeps are in it.
  if (peak < 1000) throw new Error(`silent: ${peak}`);
});

await step("a part added to it: hearing the others, with the multitrack's own tempo, time signature and first beat", async () => {
  await page.reload();
  await page.waitForLoadState("networkidle");
  const box = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Acoustic" });
  await box.getByText("1 part").waitFor();
  await box.getByTestId("record-part").click();
  if ((await dialog().getByTestId("recorder-target").inputValue()) !== first.multitrackId) throw new Error("not into Acoustic");
  await dialog().getByTestId("recorder-beat").getByText("90 BPM · 3/4").waitFor();
  await pickPart("Voice", "Lead vocal");
  // No vocals yet: it plays with the others.
  if ((await dialog().getByTestId("recorder-use").inputValue()) !== "with") throw new Error(await dialog().getByTestId("recorder-use").inputValue());
  // The guitar, to hear or not.
  await dialog().getByRole("checkbox", { name: "Guitar" }).waitFor({ timeout: 15000 });
  if (!(await dialog().getByRole("checkbox", { name: "Guitar" }).isChecked())) throw new Error("the guitar isn't heard");
  await recordAndKeep(1);
  const all = await processedFiles(webSong.id);
  const vocals = all.find((file) => file.stemPart === "VOCALS");
  const ok = all.length === 2 && vocals?.multitrackId === first.multitrackId && vocals.multitrackName === "Acoustic" && vocals.recordingTempo === 90 && vocals.recordingTimeSignature === "3/4" && vocals.recordingFirstBeat === 2;
  if (!ok) throw new Error(JSON.stringify(all));
});

await step("another take of the guitar: it plays instead, the first kept as another take - and Use this take swaps them back", async () => {
  await page.reload();
  await page.waitForLoadState("networkidle");
  const box = page.locator('[data-testid="stems-recording"]').filter({ hasText: "Acoustic" });
  await box.getByTestId("record-part").click();
  await pickPart("Instrument", "Guitar");
  const use = dialog().getByTestId("recorder-use");
  await page.waitForFunction(() => document.querySelector('[data-testid="recorder-use"]')?.value.startsWith("instead:"));
  const label = await use.locator("option:checked").textContent();
  if (!/^Plays instead of .*Guitar \(kept as another take\)$/.test(label)) throw new Error(label);
  await recordAndKeep(1);
  let guitars = (await processedFiles(webSong.id)).filter((file) => file.stemPart === "GUITAR");
  const playing = guitars.find((file) => !file.otherTake);
  if (guitars.length !== 2 || !playing || playing.id === first.id || !guitars.find((file) => file.id === first.id)?.otherTake) throw new Error(JSON.stringify(guitars));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await box.getByText("2 parts · 1 other take").waitFor();
  const row = page.getByTestId("audio-list").locator("li").filter({ has: page.getByTestId("use-take") });
  await row.getByText("Other take").waitFor();
  await row.getByTestId("use-take").click();
  for (let i = 0; i < 25; i++) {
    guitars = (await files(webSong.id)).filter((file) => file.stemPart === "GUITAR");
    if (!guitars.find((file) => file.id === first.id)?.otherTake) break;
    await page.waitForTimeout(200);
  }
  if (guitars.find((file) => file.id === first.id)?.otherTake || !guitars.find((file) => file.id === playing.id)?.otherTake) throw new Error(JSON.stringify(guitars));
});

await step("a punch-in from bar 2: the vocals replaced from there, what's before kept", async () => {
  const vocals = (await files(webSong.id)).find((file) => file.stemPart === "VOCALS");
  const before = await decoded(webSong.id, vocals);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="stems-recording"]').filter({ hasText: "Acoustic" }).getByTestId("record-part").click();
  await pickPart("Voice", "Lead vocal");
  await page.waitForFunction(() => document.querySelector('[data-testid="recorder-use"]')?.value.startsWith("instead:"));
  // Bar 2: its first beat (2 s) and a bar of 3/4 at 90 BPM (2 s) in.
  await dialog().getByTestId("recorder-what-bar").click();
  await dialog().getByTestId("recorder-from-bar").fill("2");
  await dialog().getByText("a punch-in at 0:04: what's before it stays").waitFor();
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-start").click();
  // The count-in, a bar before bar 2.
  await countIn().waitFor();
  await dialog().getByText(/Recording 0:0[4-9]/).waitFor({ timeout: 15000 });
  // Its choices folded away while recording, the level stays said in a line (issue #365): the fake microphone's beeps are heard.
  await page.waitForFunction(() => ["quiet", "good", "loud"].includes(document.querySelector('[data-testid="recorder-level"]')?.dataset.level), null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await dialog().getByTestId("recorder-stop").click();
  await dialog().getByTestId("recorder-keep").click();
  await dialog().waitFor({ state: "detached", timeout: 15000 });
  const all = (await processedFiles(webSong.id)).filter((file) => file.stemPart === "VOCALS");
  const punched = all.find((file) => !file.otherTake);
  if (all.length !== 2 || punched.id === vocals.id || !all.find((file) => file.id === vocals.id)?.otherTake) throw new Error(JSON.stringify(all));
  // From 0:00, through the punch-in at 4 s and on.
  const after = await decoded(webSong.id, punched);
  if (after.seconds < 5 || after.peak < 1000) throw new Error(`${after.seconds} s, peak ${after.peak}, before ${before.seconds} s`);
});

await step("stems uploaded as before are the song's original stems, listed first", async () => {
  r = await upload(webSong.id, "Morning Light - Bass.mp3", { stemPart: "BASS" });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const boxes = await page.getByTestId("stems-recording").evaluateAll((els) => els.map((el) => `${el.dataset.multitrack || "original"}:${el.querySelector("p")?.textContent}`));
  if (boxes.length !== 2 || !boxes[0].startsWith("original:Original stems · 1 part") || !boxes[1].includes("Acoustic · 2 parts · 2 other takes")) throw new Error(boxes.join(" | "));
});

await step("in Practice, the player offers the multitracks and plays the one chosen", async () => {
  await page.getByRole("button", { name: "Switch to Practice to play the stems together." }).click();
  const player = page.getByTestId("stem-player");
  await player.waitFor();
  await player.getByRole("button", { name: "Expand the player" }).click();
  const picker = player.getByTestId("stem-multitrack");
  const options = await picker.locator("option").allTextContents();
  if (options.join() !== "Original stems,Acoustic") throw new Error(options.join());
  const parts = async () => (await player.getByTestId("stem-track").evaluateAll((els) => els.map((el) => el.dataset.part))).join();
  if ((await parts()) !== "BASS") throw new Error(await parts());
  await picker.selectOption({ label: "Acoustic" });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="stem-track"]')].map((el) => el.dataset.part).join() === "VOCALS,GUITAR");
  await player.getByTestId("stem-recorded").getByText("Recorded in 90 BPM · 3/4").waitFor();
  await player.getByTestId("stem-play").click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor({ timeout: 15000 });
  await player.getByTestId("stem-play").click();
  // Remembered for the song.
  await page.reload();
  await page.getByTestId("stem-multitrack").waitFor();
  if ((await page.getByTestId("stem-multitrack").inputValue()) !== first.multitrackId) throw new Error(await page.getByTestId("stem-multitrack").inputValue());
  await player.getByRole("button", { name: "Expand the player" }).click();
});

/** The player expanded: it opens minimised (issue #182). */
async function expandPlayer() {
  await page.getByTestId("stem-player").getByRole("button", { name: "Expand the player" }).click();
  await page.locator('[data-testid="stem-player"][data-view="expanded"]').waitFor();
}
/** Records in the player (issue #134): from where the playhead says, for about `seconds` past the count-in. */
async function recordInPlayer(seconds) {
  await page.locator('[data-testid="recorder"][data-engine="player"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-start").click();
  await dialog().getByText(/Recording \d:\d\d/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(seconds * 1000);
  await dialog().getByTestId("recorder-stop").click();
  await dialog().getByTestId("recorder-take").waitFor({ timeout: 15000 });
}

await step("recording in the player (issue #134): from bar 2 over the mix transposed +1, the take a track to hear and nudge, then kept", async () => {
  const player = page.getByTestId("stem-player");
  // No file names in the player: parts, and who recorded them.
  if (await player.getByText(/\.(opus|wav|mp3)$/).count()) throw new Error("a file name in the player");
  await player.getByRole("button", { name: "Up a semitone" }).click();
  await player.locator('[data-testid="stem-transpose"][data-steps="1"]').waitFor();
  // Bar 2 of 90 BPM in 3/4 starts at 4 s (its first beat at 2 s): the drawer starts from the bar the playhead's in.
  await player.getByRole("slider", { name: "Position" }).fill("4.5");
  await player.getByTestId("stem-record").click();
  await page.locator('[data-testid="recorder"][data-engine="player"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByText("a punch-in at 0:04: what's before it stays").waitFor();
  // Not modal: the player behind it still takes taps.
  await player.getByRole("button", { name: "Down a semitone" }).waitFor();
  if (await page.locator('[data-testid="recorder"][role="dialog"][aria-modal="true"]').count()) throw new Error("the drawer is modal");
  await pickPart("Voice", "Harmony 3 (tenor)");
  await dialog().getByTestId("recorder-start").click();
  await countIn().waitFor();
  await dialog().getByText(/Recording 0:0[4-9]/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await dialog().getByTestId("recorder-stop").click();
  // Heard back in the player: the take, a track like the others.
  await dialog().getByTestId("recorder-preview").click();
  await player.locator('[data-testid="stem-track"]').filter({ hasText: "New take · Harmony 3 (tenor)" }).waitFor({ timeout: 15000 });
  await more();
  await dialog().getByTestId("recorder-nudge").fill("10");
  await dialog().getByText("+10 ms").waitFor();
  await dialog().getByTestId("recorder-keep").click();
  await dialog().waitFor({ state: "detached", timeout: 15000 });
  const tenor = (await processedFiles(webSong.id)).find((file) => file.stemPart === "HARMONY_TENOR");
  if (!tenor || tenor.multitrackId !== first.multitrackId || tenor.pitchOffset !== 1 || tenor.mimeType !== "audio/ogg") throw new Error(JSON.stringify(tenor));
  // From the multitrack's 0:00: silent up to bar 2, then what was recorded.
  const res = await fetch(`${API}/song-versions/${webSong.id}/attachments/${tenor.id}/download`, { headers: { Authorization: `Bearer ${me.bearer}` } });
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"], { input: Buffer.from(await res.arrayBuffer()), maxBuffer: 64 * 1024 * 1024 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  let before = 0;
  let after = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i < 3.9 * 48000) before = Math.max(before, Math.abs(samples[i]));
    else after = Math.max(after, Math.abs(samples[i]));
  }
  if (samples.length < 5 * 48000 || before > 200 || after < 1000) throw new Error(`${samples.length / 48000} s, before bar 2 ${before}, after ${after}`);
  // Back to as recorded.
  await player.getByRole("button", { name: "Down a semitone" }).click();
  await player.locator('[data-testid="stem-transpose"][data-steps="0"]').waitFor();
  await player.getByText("sung at +1").waitFor({ timeout: 15000 });
});

await step("a voice of one's own naming, and a harmony someone else recorded: named, and who recorded it (issue #131)", async () => {
  // A friend the song's shared with sings the alto; the song's editors show it to everyone who sees the song.
  const friend = await user("Alto singer");
  await api(friend, "POST", "/people/requests", { email: me.email });
  const request = (await api(me, "GET", "/people")).incoming.find((item) => item.from.id === friend.id);
  await api(me, "POST", `/people/requests/${request.id}/accept`);
  await api(me, "PUT", `/song-versions/${webSong.id}/shares/${friend.id}`, { canEdit: false });
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", "HARMONY_ALTO");
  form.append("multitrackId", first.multitrackId);
  form.append("file", new Blob([readFileSync(path.join(FIXTURES, "Morning Light - Vocals.opus"))], { type: "audio/ogg" }), "Grâce - Alto.opus");
  const alto = await (await fetch(`${API}/song-versions/${webSong.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${friend.bearer}` }, body: form })).json();
  if (alto.filename !== "Grâce - Alto.opus") throw new Error(`the name's accent: ${alto.filename}`);
  sql(`update "Attachment" set visibility='SONG' where id='${alto.id}'`);

  // Mine, recorded in the player: a descant, named.
  await page.getByTestId("stem-player").getByRole("slider", { name: "Position" }).fill("0");
  await page.getByTestId("stem-player").getByTestId("stem-record").click();
  await dialog().getByTestId("part-kind").selectOption({ label: "Voice" });
  await dialog().getByTestId("part-voice").selectOption({ label: "Another name…" });
  await dialog().getByTestId("part-name").fill("Descant");
  await dialog().getByTestId("part-name").press("Enter");
  await recordInPlayer(1);
  await dialog().getByTestId("recorder-keep").click();
  await dialog().waitFor({ state: "detached", timeout: 15000 });
  const descant = (await processedFiles(webSong.id)).find((file) => file.partName === "Descant");
  if (descant?.stemPart !== "BACKING_VOCALS" || !descant.filename.endsWith(" - Descant.opus")) throw new Error(JSON.stringify(descant));

  await page.reload();
  const player = page.getByTestId("stem-player");
  await expandPlayer();
  const row = (part) => player.locator(`[data-testid="stem-track"][data-part="${part}"]`);
  await row("HARMONY_ALTO").getByText("Harmony 2 (alto)").waitFor({ timeout: 15000 });
  await row("HARMONY_ALTO").getByText("Recorded by Alto singer").waitFor();
  // Who recorded it on its button (issue #142): their initials, without a picture.
  if ((await row("HARMONY_ALTO").getByTestId("stem-recorder").innerText()).trim() !== "AS") throw new Error("not the alto singer's initials on the button");
  await row("BACKING_VOCALS").getByText("Descant", { exact: true }).waitFor();
  // Mine says its file, not who.
  if (await row("BACKING_VOCALS").getByText(/Recorded by/).count()) throw new Error("mine says who recorded it");
  // Each part drawn as long as it is: the short takes aren't stretched to the longest.
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  const spans = await player.getByTestId("stem-waveform").evaluateAll((els) => els.map((el) => Number(el.dataset.span)));
  if (!spans.includes(1) || !spans.some((span) => span < 0.9)) throw new Error(spans.join());
});

await step("a part in sections (issue #141): the microphone's level before recording; bars 2 and 5 merged into one file, silence between", async () => {
  const player = page.getByTestId("stem-player");
  await player.getByRole("slider", { name: "Position" }).fill("0");
  await player.getByTestId("stem-record").click();
  await page.locator('[data-testid="recorder"][data-engine="player"][data-phase="ready"]').waitFor({ timeout: 15000 });
  // What the microphone hears, before anything's recorded.
  await page.waitForFunction(() => ["quiet", "good", "loud"].includes(document.querySelector('[data-testid="input-level"]')?.dataset.level), null, { timeout: 5000 });
  await pickPart("Voice", "Harmony 1 (soprano)");
  // Bar 2 (4 s): the first section.
  await dialog().getByTestId("recorder-what-bar").click();
  await dialog().getByTestId("recorder-from-bar").fill("2");
  await dialog().getByText("a punch-in at 0:04: what's before it stays").waitFor();
  await recordInPlayer(1.2);
  await dialog().getByTestId("recorder-add-section").click();
  await dialog().getByTestId("recorder-sections-kept").getByText("1 section").waitFor();
  // Bar 5 (10 s): the second.
  await more();
  await dialog().getByTestId("recorder-from-bar").fill("5");
  await dialog().getByText("a punch-in at 0:10: what's before it stays").waitFor();
  await recordInPlayer(1.2);
  await dialog().getByTestId("recorder-keep").click();
  await dialog().waitFor({ state: "detached", timeout: 15000 });
  const sopranos = (await processedFiles(webSong.id)).filter((file) => file.stemPart === "HARMONY_SOPRANO" && file.multitrackId === first.multitrackId);
  if (sopranos.length !== 1) throw new Error(JSON.stringify(sopranos));
  const res = await fetch(`${API}/song-versions/${webSong.id}/attachments/${sopranos[0].id}/download`, { headers: { Authorization: `Bearer ${me.bearer}` } });
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"], { input: Buffer.from(await res.arrayBuffer()), maxBuffer: 64 * 1024 * 1024 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const peak = (from, to) => {
    let max = 0;
    for (let i = Math.round(from * 48000); i < Math.min(samples.length, Math.round(to * 48000)); i++) max = Math.max(max, Math.abs(samples[i]));
    return max;
  };
  const levels = { before: peak(0, 3.9), first: peak(4, 5.6), between: peak(6.2, 9.8), second: peak(10, 11.6) };
  if (levels.before > 200 || levels.between > 200 || levels.first < 1000 || levels.second < 1000) throw new Error(JSON.stringify({ seconds: samples.length / 48000, ...levels }));
});

await step("a recording's actions (issue #142): its name opens them; merged with another take into one file, then one deleted", async () => {
  const player = page.getByTestId("stem-player");
  await page.reload();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await expandPlayer();
  const row = (part) => player.locator(`[data-testid="stem-track"][data-part="${part}"]`);
  // Someone else's (the alto's) has no actions; mine (the soprano's) does.
  if (await row("HARMONY_ALTO").getByTestId("stem-track-name").count()) throw new Error("actions on someone else's recording");
  await row("HARMONY_SOPRANO").getByTestId("stem-track-name").click();
  const actions = row("HARMONY_SOPRANO").getByTestId("stem-track-actions");
  await actions.getByTestId("stem-track-record-into").waitFor();
  await actions.getByTestId("stem-track-merge").click();
  // Only those sung in the same key: not the tenor, sung at +1.
  const options = await actions.getByTestId("stem-track-merge-with").locator("option").allInnerTexts();
  if (options.includes("Harmony 3 (tenor)") || !options.includes("Descant")) throw new Error(options.join());
  await actions.getByTestId("stem-track-merge-with").selectOption({ label: "Descant" });
  await actions.getByTestId("stem-track-merge-confirm").click();
  await actions.waitFor({ state: "detached", timeout: 20000 });
  // One file in their place, the soprano's part: both kept as other takes.
  const all = await processedFiles(webSong.id);
  const played = all.filter((file) => file.multitrackId === first.multitrackId && !file.otherTake);
  const soprano = played.filter((file) => file.stemPart === "HARMONY_SOPRANO");
  if (soprano.length !== 1 || played.some((file) => file.partName === "Descant")) throw new Error(JSON.stringify(played.map((file) => [file.stemPart, file.partName, file.otherTake])));
  const others = all.filter((file) => file.multitrackId === first.multitrackId && file.otherTake && (file.stemPart === "HARMONY_SOPRANO" || file.partName === "Descant"));
  if (others.length < 2) throw new Error(`${others.length} other takes`);
  // Both in it: the descant's start, and the soprano's second section.
  const res = await fetch(`${API}/song-versions/${webSong.id}/attachments/${soprano[0].id}/download`, { headers: { Authorization: `Bearer ${me.bearer}` } });
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"], { input: Buffer.from(await res.arrayBuffer()), maxBuffer: 64 * 1024 * 1024 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const peak = (from, to) => {
    let max = 0;
    for (let i = Math.round(from * 48000); i < Math.min(samples.length, Math.round(to * 48000)); i++) max = Math.max(max, Math.abs(samples[i]));
    return max;
  };
  if (peak(0.2, 1.5) < 1000 || peak(10, 11.6) < 1000) throw new Error(`the descant ${peak(0.2, 1.5)}, the soprano's second section ${peak(10, 11.6)}`);

  // Deleted, after asking.
  await page.reload();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await expandPlayer();
  await row("HARMONY_SOPRANO").getByTestId("stem-track-name").click();
  await row("HARMONY_SOPRANO").getByTestId("stem-track-delete").click();
  await row("HARMONY_SOPRANO").getByText(/can't be undone/).waitFor();
  await row("HARMONY_SOPRANO").getByTestId("stem-track-delete-confirm").click();
  await row("HARMONY_SOPRANO").waitFor({ state: "detached", timeout: 20000 });
  if ((await files(webSong.id)).some((file) => file.id === soprano[0].id)) throw new Error("not deleted");
});

await step("recording into a recording (issue #142): its part and itself chosen in the recorder", async () => {
  const player = page.getByTestId("stem-player");
  const row = player.locator('[data-testid="stem-track"][data-part="GUITAR"]');
  await row.getByTestId("stem-track-name").click();
  await row.getByTestId("stem-track-record-into").click();
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  if ((await dialog().getByTestId("part-instrument").inputValue()) !== "GUITAR") throw new Error(await dialog().getByTestId("part-instrument").inputValue());
  if (!(await dialog().getByTestId("recorder-use").inputValue()).startsWith("instead:")) throw new Error("not into it");
  await dialog().getByTestId("recorder-dismiss").click();
  await dialog().waitFor({ state: "detached" });
});

const sunday = await api(me, "POST", "/setlists", { name: `Sunday ${stamp}` });
const [sundayItem] = (await api(me, "POST", `/setlists/${sunday.id}/items`, { songVersionId: webSong.id })).items;
let sundayBand;
await step("on a set's song page: a new multitrack for that set, what the player picks there", async () => {
  await page.goto(`${WEB}/sets/${sunday.id}/songs/${sundayItem.id}`);
  const player = page.getByTestId("stem-player");
  await player.waitFor();
  await expandPlayer();
  // A new multitrack: from the player's recording drawer.
  await player.getByTestId("stem-record").click();
  await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor({ timeout: 15000 });
  await dialog().getByTestId("recorder-target").selectOption("new");
  await dialog().getByText(`For this set: Sunday ${stamp}`).waitFor();
  if (!(await dialog().getByTestId("recorder-for-set").isChecked())) throw new Error("not for the set");
  await dialog().getByTestId("recorder-name").fill("Sunday band");
  await pickPart("Instrument", "Piano and keys");
  await recordAndKeep(1);
  sundayBand = (await files(webSong.id)).find((file) => file.multitrackName === "Sunday band");
  if (sundayBand?.multitrackSetlistId !== sunday.id || sundayBand.stemPart !== "KEYS") throw new Error(JSON.stringify(sundayBand));
  // Listed again, the set's multitrack is the one the player picks here.
  await page.waitForFunction((id) => document.querySelector('[data-testid="stem-multitrack"]')?.value === id, sundayBand.multitrackId, { timeout: 15000 });
  // Elsewhere, what was chosen for the song.
  await page.goto(`${WEB}/library/${webSong.id}`);
  await page.getByTestId("stem-multitrack").waitFor();
  if ((await page.getByTestId("stem-multitrack").inputValue()) !== first.multitrackId) throw new Error(await page.getByTestId("stem-multitrack").inputValue());
});

await step("a file moved into a new multitrack of its own: another version", async () => {
  await page.goto(`${WEB}/library/${webSong.id}?tab=audio`);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Multitrack of Morning Light - Bass.mp3").selectOption({ label: "New multitrack" });
  let bass;
  for (let i = 0; i < 25; i++) {
    bass = (await files(webSong.id)).find((file) => file.stemPart === "BASS");
    if (bass?.multitrackId) break;
    await page.waitForTimeout(200);
  }
  if (!bass?.multitrackId || bass.multitrackId === first.multitrackId) throw new Error(JSON.stringify(bass));
  await page.locator(`[data-testid="stems-recording"][data-multitrack="${bass.multitrackId}"]`).locator("p", { hasText: "Multitrack 2" }).first().waitFor();
  // The set's, said so.
  await page.locator(`[data-testid="stems-recording"][data-multitrack="${sundayBand.multitrackId}"]`).getByText(`Recorded for Sunday ${stamp}`).waitFor();
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join("\n"));
});

await browser.close();
finish();
