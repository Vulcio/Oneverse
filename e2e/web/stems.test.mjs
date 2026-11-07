// The stem player (issue #64): audio files marked as parts of the song -
// by their names on upload, or by hand - played together in Practice, each
// part with its own mute and solo. MP3 and Opus files (e2e/fixtures/stems).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { sidebarGo, API, WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems");
const fixture = (name) => path.join(FIXTURES, name);

let page;
const step = stepper(() => page);
const me = await user("Drummer");
const stranger = await user("Stranger");
const song = (title) => api(me, "POST", "/song-versions", { title, language: "en", artists: [`Band ${stamp}`], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO" });
const upload = async (songId, name, type, fields = {}, mime = "application/octet-stream") => {
  const form = new FormData();
  form.append("type", type);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([readFileSync(fixture(name))], { type: mime }), name);
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// --- the API
const apiSong = await song(`Stems API ${stamp}`);
let r = await upload(apiSong.id, "Morning Light - Vocals.opus", "AUDIO", { stemPart: "VOCALS" });
check("an .opus file with no audio type is recognised by its bytes, as a stem", r.status === 201 && r.body.mimeType === "audio/ogg" && r.body.stemPart === "VOCALS", JSON.stringify(r.body));
const vocals = r.body;
r = await upload(apiSong.id, "03 drums.mp3", "AUDIO", {}, "audio/mpeg");
check("without a part it's a plain recording", r.status === 201 && r.body.stemPart === null);
const drums = r.body;
r = await upload(apiSong.id, "03 drums.mp3", "AUDIO", { stemPart: "TRIANGLE" }, "audio/mpeg");
check("an unknown part is refused", r.status === 400, String(r.status));
r = await upload(apiSong.id, "03 drums.mp3", "OTHER", { stemPart: "DRUMS" });
check("only audio can be a stem", r.status === 400, String(r.status));
const other = (await upload(apiSong.id, "03 drums.mp3", "OTHER")).body;

const version = async () => (await api(me, "POST", "/offline/sync", {})).songs.find((s) => s.id === apiSong.id)?.version;
const before = await version();
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { stemPart: "DRUMS" });
check("a file's part can be set", r.status === 200 && r.body.stemPart === "DRUMS", JSON.stringify(r.body));
check("which changes the song's offline version", (await version()) !== before);
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${vocals.id}`, { stemPart: null });
check("and cleared", r.status === 200 && r.body.stemPart === null);
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${vocals.id}`, { stemPart: "KAZOO" });
check("an unknown part is refused", r.status === 400, String(r.status));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${other.id}`, { stemPart: "BASS" });
check("a file that isn't audio can't be a stem", r.status === 400, String(r.status));
r = await call(stranger, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { stemPart: "BASS" });
check("someone else can't change it", r.status === 403 || r.status === 404, String(r.status));
r = await call(me, "GET", `/song-versions/${apiSong.id}/attachments`);
check("the list gives each file's part", r.body.find((a) => a.id === drums.id)?.stemPart === "DRUMS" && r.body.find((a) => a.id === other.id)?.stemPart === null);

// The recording's key and tempo (issue #65)
const before65 = await version();
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { recordingKey: "Gb", recordingTempo: 68.5 });
check("a recording's key (as written) and tempo; its part stays", r.status === 200 && r.body.recordingKey === "Gb" && r.body.recordingTempo === 68.5 && r.body.stemPart === "DRUMS", JSON.stringify(r.body));
check("which changes the song's offline version too", (await version()) !== before65);
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { recordingKey: "H#" });
check("a key that isn't one is refused", r.status === 400, String(r.status));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { recordingFirstBeat: -1 });
check("a first beat before the start: no", r.status === 400, String(r.status));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { recordingTempo: 1000 });
check("so is a tempo out of range", r.status === 400, String(r.status));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${other.id}`, { recordingKey: "G" });
check("a file that isn't audio has no recording key", r.status === 400, String(r.status));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { recordingKey: "", recordingTempo: null });
check("empty goes back to the song's", r.status === 200 && r.body.recordingKey === null && r.body.recordingTempo === null && r.body.stemPart === "DRUMS", JSON.stringify(r.body));
// Cue points (issue #110): kept in time order; a time that can't be one refused; none clears them.
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { cuePoints: [{ at: 12.5, sectionId: "sec_b" }, { at: 0, sectionId: "sec_a" }] });
check("cue points kept, in time order", r.status === 200 && JSON.stringify(r.body.cuePoints) === JSON.stringify([{ at: 0, sectionId: "sec_a" }, { at: 12.5, sectionId: "sec_b" }]), JSON.stringify(r.body?.cuePoints));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { cuePoints: [{ at: -1, sectionId: "sec_a" }] });
check("a cue point before the start is refused", r.status === 400 && r.body.message.some((m) => m.includes("cuePoints")), JSON.stringify(r.body));
r = await call(me, "PATCH", `/song-versions/${apiSong.id}/attachments/${drums.id}`, { cuePoints: [] });
check("none clears them", r.status === 200 && r.body.cuePoints === null, JSON.stringify(r.body?.cuePoints));

// --- the web app
const webSong = await song(`Stems ${stamp}`);
const set = await api(me, "POST", "/setlists", { name: `Stem set ${stamp}` });
const [item] = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: webSong.id })).items;

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
// A file's part (issue #131): a voice, an instrument or cues, then which.
const pickerOf = (name) => page.getByTestId("audio-list").locator("li").filter({ hasText: name }).getByTestId("part-picker");
const partOf = async (name) => (await pickerOf(name).getAttribute("data-part")) ?? "";
const player = () => page.getByTestId("stem-player");
const track = (part) => player().locator(`[data-testid="stem-track"][data-part="${part}"]`);

await step("uploading stems: named parts are recognised, MP3 and Opus", async () => {
  await page.goto(`${WEB}/library/${webSong.id}?tab=audio`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("audio-input").setInputFiles(["Morning Light - Vocals.opus", "Morning Light - Bass.mp3", "03 drums.mp3", "track4.opus"].map(fixture));
  await page.getByTestId("audio-list").locator("li").nth(3).waitFor();
  const parts = {};
  for (const name of ["Morning Light - Vocals.opus", "Morning Light - Bass.mp3", "03 drums.mp3", "track4.opus"]) parts[name] = await partOf(name);
  if (JSON.stringify(parts) !== JSON.stringify({ "Morning Light - Vocals.opus": "VOCALS", "Morning Light - Bass.mp3": "BASS", "03 drums.mp3": "DRUMS", "track4.opus": "" })) {
    throw new Error(JSON.stringify(parts));
  }
});

await step("a recording plays from a streamed link, and seeks", async () => {
  const ranges = [];
  page.on("response", (res) => {
    if (res.url().includes("/files/")) ranges.push(res.status());
  });
  const row = page.getByTestId("audio-list").locator("li").filter({ hasText: "Morning Light - Bass.mp3" });
  await row.getByRole("button", { name: "Play", exact: true }).click();
  const audio = row.locator("audio");
  await audio.waitFor();
  if (!(await audio.getAttribute("src")).includes("/files/")) throw new Error(await audio.getAttribute("src"));
  await page.waitForFunction((el) => el.duration > 3, await audio.elementHandle());
  await audio.evaluate((el) => {
    el.pause();
    el.currentTime = 2.5;
  });
  await page.waitForFunction((el) => el.readyState >= 2 && Math.abs(el.currentTime - 2.5) < 0.2, await audio.elementHandle());
  if (!ranges.includes(206)) throw new Error(`no partial response: ${ranges.join()}`);
});

await step("a link that stopped working is replaced, and it plays on", async () => {
  const drumsId = (await api(me, "GET", `/song-versions/${webSong.id}/attachments`)).find((a) => a.filename === "03 drums.mp3").id;
  const links = new Set();
  // The first link fails, as an expired one would; the ones after work.
  await page.route(
    (url) => {
      if (url.pathname !== `/files/${drumsId}`) return false;
      links.add(url.search);
      return links.size === 1;
    },
    (route) => route.fulfill({ status: 403, body: "expired" }),
  );
  const row = page.getByTestId("audio-list").locator("li").filter({ hasText: "03 drums.mp3" });
  await row.getByRole("button", { name: "Play", exact: true }).click();
  const audio = row.locator("audio");
  await audio.waitFor();
  await page.waitForFunction((el) => el.duration > 3, await audio.elementHandle());
  if (links.size !== 2) throw new Error(`${links.size} links`);
  if (await row.getByText("Couldn't load it.").count()) throw new Error("shown as failed");
});

await step("a file the name doesn't tell is assigned by hand", async () => {
  await page.getByLabel("Stem for track4.opus", { exact: true }).selectOption({ label: "Instrument" });
  await pickerOf("track4.opus").getByTestId("part-instrument").waitFor();
  await pickerOf("track4.opus").getByTestId("part-instrument").selectOption({ label: "Piano and keys" });
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 25 && (await api(me, "GET", `/song-versions/${webSong.id}/attachments`)).find((a) => a.filename === "track4.opus")?.stemPart !== "KEYS"; i++) await page.waitForTimeout(200);
  if ((await partOf("track4.opus")) !== "KEYS") throw new Error("not saved");
});

const chips = () => player().getByTestId("stem-chip");
const floating = () => page.getByTestId("stem-return");
const time = async () => (await player().getByTestId("stem-time").textContent()).trim();
const seconds = (text) => {
  const [m, s] = text.split(" / ")[0].split(":").map(Number);
  return m * 60 + s;
};

await step("the stems share one recording's key and tempo", async () => {
  const box = page.getByTestId("stems-recording");
  await box.getByLabel("Key of the stems").selectOption("A");
  await page.waitForLoadState("networkidle");
  await box.getByLabel("Tempo of the stems (BPM)").fill("80");
  await box.getByLabel("Tempo of the stems (BPM)").press("Enter");
  let files = [];
  for (let i = 0; i < 25; i++) {
    files = (await api(me, "GET", `/song-versions/${webSong.id}/attachments`)).filter((a) => a.stemPart);
    if (files.every((a) => a.recordingKey === "A" && a.recordingTempo === 80)) break;
    await page.waitForTimeout(200);
  }
  if (!files.every((a) => a.recordingKey === "A" && a.recordingTempo === 80)) throw new Error(JSON.stringify(files.map((a) => [a.recordingKey, a.recordingTempo])));
  // Where the first beat falls (issue #100), for the metronome with them.
  await box.getByLabel("First beat of the stems (seconds)").fill("1.25");
  await box.getByLabel("First beat of the stems (seconds)").press("Enter");
  for (let i = 0; i < 25; i++) {
    files = (await api(me, "GET", `/song-versions/${webSong.id}/attachments`)).filter((a) => a.stemPart);
    if (files.every((a) => a.recordingFirstBeat === 1.25)) break;
    await page.waitForTimeout(200);
  }
  if (!files.every((a) => a.recordingFirstBeat === 1.25)) throw new Error(JSON.stringify(files.map((a) => a.recordingFirstBeat)));
  // Played freely before it (issue #178): the click waits for it. Ticked, then not.
  for (const free of [true, false]) {
    await box.getByLabel("Free intro before the first beat of the stems").setChecked(free);
    for (let i = 0; i < 25; i++) {
      files = (await api(me, "GET", `/song-versions/${webSong.id}/attachments`)).filter((a) => a.stemPart);
      if (files.every((a) => a.recordingFreeIntro === free)) break;
      await page.waitForTimeout(200);
    }
    if (!files.every((a) => a.recordingFreeIntro === free)) throw new Error(JSON.stringify(files.map((a) => a.recordingFreeIntro)));
  }
});

await step("in Edit there's no player, just the way to Practice", async () => {
  if (await player().count()) throw new Error("a player in Edit");
  // Slowed down, to see them download.
  const slow = (route) => setTimeout(() => void route.continue(), 800);
  await page.route("**/attachments/*/download", slow);
  await page.getByRole("button", { name: "Switch to Practice to play the stems together." }).click();
  await player().waitFor();
  if ((await page.evaluate(() => document.documentElement.dataset.mode)) !== "practice") throw new Error("not Practice");
  // They start downloading as the page opens in Practice, with the progress along the top.
  await player().getByRole("progressbar", { name: /Loading the stems… \d+%/ }).waitFor();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor();
  await page.unroute("**/attachments/*/download", slow);
});

await step("docked at the bottom, minimised (issue #182): play, and what plays named - the stems, no part's controls", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await player().boundingBox();
  if (Math.abs(box.y + box.height - 900) > 2) throw new Error(`not at the bottom: ${JSON.stringify(box)}`);
  if ((await player().getAttribute("data-view")) !== "compact") throw new Error("not compact");
  if (box.height > 64) throw new Error(`${box.height}px high`);
  await player().getByTestId("stem-recording-name").getByText("Original stems").waitFor();
  await player().getByTestId("stem-part-count").getByText("4 parts").waitFor();
  if (await chips().count()) throw new Error("a part's button minimised");
  // Only stems, no recording to play instead: nothing to switch to.
  if (await player().getByTestId("stem-switch-multitrack").count()) throw new Error("a switch with nothing to switch to");
});

await step("Play plays every part together", async () => {
  await player().getByRole("button", { name: "Play", exact: true }).click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="stem-time"]')?.textContent?.startsWith("0:01"));
  if (!(await time()).endsWith("/ 0:20")) throw new Error(await time());
});

await step("expanded: a row per part with its waveform, mute and solo; the waveform seeks", async () => {
  await player().getByRole("button", { name: "Expand the player" }).click();
  await page.locator('[data-testid="stem-player"][data-view="expanded"]').waitFor();
  await player().getByTestId("stem-waveform").nth(3).waitFor();
  await player().getByTestId("stem-recorded").getByText("Recorded in A · 80 BPM").waitFor();
  if (await player().getByText("can't be played").count()) throw new Error("a stem didn't decode");
  // A round button mutes its part.
  await track("VOCALS").getByTestId("stem-part").click();
  await track("VOCALS").and(page.locator('[data-audible="false"]')).waitFor();
  // Its round button toggles here too.
  await track("KEYS").getByTestId("stem-part").click();
  await track("KEYS").and(page.locator('[data-audible="false"]')).waitFor();
  await track("KEYS").getByTestId("stem-part").click();
  await track("KEYS").and(page.locator('[data-audible="true"]')).waitFor();
  await player().getByRole("button", { name: "Solo Drums" }).click();
  const audible = await player().getByTestId("stem-track").evaluateAll((rows) => rows.map((row) => `${row.dataset.part}:${row.dataset.audible}`));
  if (audible.join() !== "VOCALS:false,DRUMS:true,BASS:false,KEYS:false") throw new Error(audible.join());
  await player().getByRole("button", { name: "Solo Drums" }).click();
  await track("BASS").and(page.locator('[data-audible="true"]')).waitFor();
  const wave = await track("BASS").getByTestId("stem-waveform").boundingBox();
  await page.mouse.click(wave.x + wave.width * 0.6, wave.y + wave.height / 2);
  await page.waitForFunction(() => {
    const [m, s] = document.querySelector('[data-testid="stem-time"]').textContent.split(" / ")[0].split(":").map(Number);
    return m * 60 + s >= 11;
  });
});

await step("it plays on elsewhere, with a button back to the song", async () => {
  const before = seconds(await time());
  await sidebarGo(page, "Sets");
  await page.waitForURL(`${WEB}/sets`);
  await floating().getByText(`Stems ${stamp}`).waitFor();
  if (await player().count()) throw new Error("the dock followed");
  await page.waitForTimeout(1500);
  await floating().getByRole("button", { name: `Back to Stems ${stamp}` }).click();
  await page.waitForURL(`**/library/${webSong.id}`);
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor();
  if (seconds(await time()) < before + 1) throw new Error(`${await time()}, was ${before}s`);
  if (await floating().count()) throw new Error("the floating button stayed");
});

await step("leaving Practice keeps it playing; the floating button pauses it", async () => {
  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Edit" }).click();
  await floating().waitFor();
  if (await player().count()) throw new Error("a dock in Edit");
  await floating().getByRole("button", { name: "Pause", exact: true }).click();
  await floating().waitFor({ state: "detached" });
  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Practice" }).click();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor();
  if (seconds(await time()) < 11) throw new Error(`lost its place: ${await time()}`);
});

await step("at the end it stops and goes back to the start", async () => {
  await player().getByLabel("Position").fill("19");
  await player().getByRole("button", { name: "Play", exact: true }).click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 10_000 });
  if ((await time()) !== "0:00 / 0:20") throw new Error(await time());
});

await step("a set's song has the player too, in Practice, minimised as the page opens (issue #182)", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="stem-player"][data-view="compact"]').waitFor();
  await player().getByRole("button", { name: "Expand the player" }).click();
  await track("KEYS").waitFor();
  await player().getByRole("button", { name: "Play", exact: true }).click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor();
  await player().getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor();
});

await step("minimised, the mixer is off (issue #182): no part's controls, and expanded again, no faders", async () => {
  await player().getByTestId("stem-mixer").click();
  await track("KEYS").getByTestId("stem-volume").waitFor();
  await player().getByRole("button", { name: "Minimize the player" }).click();
  if ((await chips().count()) || (await player().getByTestId("stem-volume").count())) throw new Error("a part's controls minimised");
  if ((await page.evaluate(() => localStorage.getItem("songverse.stems.mixer"))) !== "false") throw new Error("the mixer still on");
  await player().getByRole("button", { name: "Expand the player" }).click();
  await track("KEYS").waitFor();
  if ((await player().getByTestId("stem-mixer").getAttribute("aria-pressed")) !== "false" || (await player().getByTestId("stem-volume").count())) throw new Error("the mixer back on");
});

await step("through an <audio> element (as on iPhone, to play on with the screen locked)", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.stems.output", "element"));
  await page.goto(`${WEB}/library/${webSong.id}`);
  await page.waitForLoadState("networkidle");
  await player().getByRole("button", { name: "Play", exact: true }).click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="stem-time"]')?.textContent?.startsWith("0:02"));
  // Through the element, on screen too: iOS stopped the stems at the lock screen when they weren't (issue #136).
  await page.waitForFunction(() => window.songverseStems?.heardVia === "element");
  const session = await page.evaluate(() => [navigator.mediaSession.playbackState, navigator.mediaSession.metadata?.title]);
  if (session.join() !== `playing,Stems ${stamp}`) throw new Error(`lock screen: ${session.join()}`);
  // Its artist, and without an image its cover drawn from its title (issue #173).
  await page.waitForFunction(() => (navigator.mediaSession.metadata?.artwork.length ?? 0) > 0);
  const shown = await page.evaluate(() => [navigator.mediaSession.metadata.artist, navigator.mediaSession.metadata.artwork[0].src, navigator.mediaSession.metadata.artwork[0].sizes]);
  if (shown[0] !== `Band ${stamp}` || !shown[1].startsWith("blob:") || shown[2] !== "512x512") throw new Error(`lock screen: ${shown.join()}`);
  await player().getByRole("button", { name: "Pause", exact: true }).click();
  if ((await page.evaluate(() => navigator.mediaSession.playbackState)) !== "paused") throw new Error("still playing on the lock screen");
  await page.evaluate(() => localStorage.removeItem("songverse.stems.output"));
});

await step("on a phone it fits", async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${WEB}/library/${webSong.id}`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  const box = await player().boundingBox();
  if (box.x < 0 || box.x + box.width > 360 || Math.abs(box.y + box.height - 740) > 2) throw new Error(JSON.stringify(box));
  // Clear of a phone's rounded corners.
  const play = await player().getByRole("button", { name: "Play", exact: true }).boundingBox();
  if (play.x < 16 || box.y + box.height - (play.y + play.height) < 12) throw new Error(`the Play button is at ${JSON.stringify(play)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(`${overflow}px sideways scroll`);
  // Expanded, minimize is on the screen, clear of its edge: the other controls wrap below.
  await player().getByRole("button", { name: "Expand the player" }).click();
  const minimize = await player().getByTestId("stem-minimize").boundingBox();
  if (minimize.x + minimize.width > 360 - 12) throw new Error(`minimize at ${JSON.stringify(minimize)}`);
  const controls = await player().getByTestId("stem-controls").boundingBox();
  if (controls.x + controls.width > 360) throw new Error(`controls at ${JSON.stringify(controls)}`);
  // The tools on the first line, with Play and minimize (issue #140); the transposition on the next.
  const tools = await player().getByTestId("stem-tools").boundingBox();
  const playing = await player().getByTestId("stem-play").boundingBox();
  const centre = (b) => b.y + b.height / 2;
  if (Math.abs(centre(tools) - centre(playing)) > 4 || Math.abs(centre(minimize) - centre(playing)) > 4 || tools.x + tools.width > minimize.x) throw new Error(`tools at ${JSON.stringify(tools)}, Play at ${JSON.stringify(playing)}`);
  if (centre(controls) <= centre(playing) + 10) throw new Error(`the transposition beside Play: ${JSON.stringify(controls)}`);
  for (const id of ["stem-combine", "stem-mixer", "stem-click"]) await player().getByTestId("stem-tools").getByTestId(id).waitFor();
});

await step("the mixer (issue #140): a fader over each waveform on a phone, the waveform as loud; remembered, and reset", async () => {
  await player().getByTestId("stem-mixer").click();
  const row = player().getByTestId("stem-track").first();
  const fader = row.getByTestId("stem-volume");
  await fader.waitFor();
  // Over the waveform, on a phone.
  const faderBox = await fader.boundingBox();
  const waveBox = await row.getByTestId("stem-waveform").boundingBox();
  if (faderBox.x > waveBox.x + 2 || faderBox.x + faderBox.width < waveBox.x + waveBox.width - 2) throw new Error(`fader ${JSON.stringify(faderBox)}, waveform ${JSON.stringify(waveBox)}`);
  const height = () => row.getByTestId("stem-waveform").evaluate((svg) => svg.querySelector("path").getBBox().height);
  const full = await height();
  await fader.fill("50");
  await page.waitForFunction(() => document.querySelector('[data-testid="stem-volume"]')?.getAttribute("aria-valuetext") === "50%");
  const half = await height();
  if (!(half < full * 0.6 && half > full * 0.4)) throw new Error(`waveform ${full} high, at 50% ${half}`);
  await page.reload();
  await player().getByRole("button", { name: "Expand the player" }).click();
  await player().getByTestId("stem-track").first().getByTestId("stem-volume").waitFor();
  if ((await player().getByTestId("stem-track").first().getByTestId("stem-volume").inputValue()) !== "50") throw new Error("not remembered");
  await player().getByTestId("stem-mixer-reset").click();
  if ((await player().getByTestId("stem-track").first().getByTestId("stem-volume").inputValue()) !== "100") throw new Error("not reset");
  // On a wide screen, beside the waveform, which still seeks.
  await page.setViewportSize({ width: 1280, height: 900 });
  const wideFader = await player().getByTestId("stem-track").first().getByTestId("stem-volume").boundingBox();
  const wideWave = await player().getByTestId("stem-track").first().getByTestId("stem-waveform").boundingBox();
  if (wideFader.x < wideWave.x + wideWave.width - 2) throw new Error(`fader ${JSON.stringify(wideFader)} over the waveform ${JSON.stringify(wideWave)}`);
  await player().getByTestId("stem-mixer").click();
  await page.setViewportSize({ width: 360, height: 740 });
});

await step("the parts combined (issue #137): their buttons and one waveform, a fraction of the height; remembered", async () => {
  const before = (await player().boundingBox()).height;
  await player().getByTestId("stem-combine").click();
  await player().getByTestId("stem-combined").waitFor();
  if (await player().getByTestId("stem-track").count()) throw new Error("the parts' rows still there");
  if ((await player().getByTestId("stem-combined").getByTestId("stem-chip").count()) !== 4) throw new Error("not a button per part");
  await player().getByTestId("stem-combined").getByTestId("stem-waveform").waitFor();
  const after = (await player().boundingBox()).height;
  if (after > before * 0.7) throw new Error(`${after}px high, ${before}px apart`);
  await page.reload();
  await player().getByRole("button", { name: "Expand the player" }).click();
  await player().getByTestId("stem-combined").waitFor();
  // Back apart, and compact.
  await player().getByTestId("stem-combine").click();
  await player().getByTestId("stem-track").first().waitFor();
  await player().getByTestId("stem-minimize").click();
});

await step("M and S on each row (issue #142): S green while soloed; M beside it on a wide screen, not on a phone", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${WEB}/library/${webSong.id}`);
  await player().getByRole("button", { name: "Expand the player" }).click();
  const solo = track("DRUMS").getByTestId("stem-solo");
  if ((await solo.innerText()).trim() !== "S") throw new Error("no S");
  await solo.click();
  if ((await solo.getAttribute("aria-pressed")) !== "true" || !(await solo.getAttribute("class")).includes("bg-primary")) throw new Error("S not green when on");
  await solo.click();
  // M, left of S, mutes its part.
  const mute = track("BASS").getByTestId("stem-mute");
  const [m, sBox] = [await mute.boundingBox(), await track("BASS").getByTestId("stem-solo").boundingBox()];
  if (!m || m.x >= sBox.x) throw new Error(`M at ${JSON.stringify(m)}, S at ${JSON.stringify(sBox)}`);
  await mute.click();
  await track("BASS").and(page.locator('[data-audible="false"]')).waitFor();
  await mute.click();
  await track("BASS").and(page.locator('[data-audible="true"]')).waitFor();
  await page.setViewportSize({ width: 360, height: 740 });
  if (await track("BASS").getByTestId("stem-mute").isVisible()) throw new Error("M on a phone");
  await page.setViewportSize({ width: 1280, height: 900 });
});

await step("the parts combined with the mixer on (issue #142): one waveform, and each part's button and fader", async () => {
  await player().getByTestId("stem-combine").click();
  await player().getByTestId("stem-mixer").click();
  await player().getByTestId("stem-combined").getByTestId("stem-waveform").waitFor();
  if ((await player().getByTestId("stem-combined-part").count()) !== 4) throw new Error("not a fader per part");
  await player().getByTestId("stem-combined-part").first().getByTestId("stem-volume").fill("30");
  await player().getByTestId("stem-mixer-reset").click();
  await player().getByTestId("stem-mixer").click();
  if (await player().getByTestId("stem-combined-mixer").count()) throw new Error("faders without the mixer");
  await player().getByTestId("stem-combine").click();
  await track("DRUMS").waitFor();
});

await step("an uploaded stem is locked (issue #145): no actions, no badge - until its uploader unlocks it on the Audio tab", async () => {
  if (await track("DRUMS").getByTestId("stem-track-name").count()) throw new Error("actions on a locked stem");
  if (await track("DRUMS").getByTestId("stem-recorder").count()) throw new Error("a badge on a locked stem");
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.goto(`${WEB}/library/${webSong.id}?tab=audio`);
  const row = page.getByTestId("audio-list").locator("li").filter({ hasText: "03 drums.mp3" });
  const lock = row.getByTestId("file-lock");
  if ((await lock.getAttribute("aria-pressed")) !== "true" || !(await row.getByTestId("file-remove").isDisabled())) throw new Error("not locked");
  await lock.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="file-lock"]')].some((button) => button.getAttribute("aria-pressed") === "false"));
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${webSong.id}`);
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  if ((await player().getAttribute("data-view")) !== "expanded") await player().getByRole("button", { name: "Expand the player" }).click();
});

await step("a part of one's own, among the original stems (issue #142): its name opens its actions", async () => {
  await track("DRUMS").getByTestId("stem-track-name").click();
  const actions = track("DRUMS").getByTestId("stem-track-actions");
  await actions.getByTestId("stem-track-record-into").waitFor();
  await actions.getByTestId("stem-track-delete").waitFor();
  await track("DRUMS").getByTestId("stem-track-name").click();
  await actions.waitFor({ state: "detached" });
});

// Cue points (issue #110): a song with a verse and a chorus sung twice.
const cued = await api(me, "POST", "/song-versions", {
  title: `Cued ${stamp}`,
  language: "en",
  artists: [`Band ${stamp}`],
  content: "{start_of_verse}\n[G]Hello\n{end_of_verse}\n{start_of_chorus}\n[C]World\n{end_of_chorus}\n{chorus}\n",
  contentFormat: "CHORDPRO",
});
for (const [name, part] of [["Morning Light - Vocals.opus", "VOCALS"], ["Morning Light - Bass.mp3", "BASS"]]) await upload(cued.id, name, "AUDIO", { stemPart: part });

await step("placing the sections (issue #110): Mark at each as it plays, in the song's order; typed, saved on every file", async () => {
  await page.goto(`${WEB}/library/${cued.id}`);
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  if ((await player().getAttribute("data-view")) !== "expanded") await player().getByRole("button", { name: "Expand the player" }).click();
  await player().getByTestId("stem-cues").click();
  const editor = player().getByTestId("stem-cue-editor");
  await editor.waitFor();
  const position = player().getByRole("slider", { name: "Position" });
  await position.fill("0");
  await editor.getByRole("button", { name: "Mark Verse" }).click();
  await position.fill("5");
  await editor.getByRole("button", { name: "Mark Chorus" }).click();
  // M marks too: the chorus again.
  await position.fill("12");
  await page.locator("body").press("m");
  await editor.getByTestId("stem-cue").nth(2).waitFor();
  // Typed: the second chorus a little later.
  const third = editor.getByTestId("stem-cue-time").nth(2);
  await third.fill("0:12.5");
  await third.press("Enter");
  // Shown on the player as it's edited.
  if ((await player().getByTestId("stem-section").count()) !== 3) throw new Error("the sections not shown while editing");
  await editor.getByTestId("stem-cue-save").click();
  await editor.waitFor({ state: "detached", timeout: 15000 });
  const files = await api(me, "GET", `/song-versions/${cued.id}/attachments`);
  const cues = files.map((file) => JSON.stringify(file.cuePoints?.map((cue) => cue.at)));
  if (files.length !== 2 || cues.some((value) => value !== "[0,5,12.5]")) throw new Error(cues.join(" "));
});

await step("the sections on the player (issue #110): a strip to jump by, the one playing named, the playhead line in their colours", async () => {
  await page.reload();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await player().getByRole("button", { name: "Expand the player" }).click();
  const lane = player().getByTestId("stem-sections");
  const labels = await lane.getByTestId("stem-section").allInnerTexts();
  if (labels.map((label) => label.trim()).join() !== "V,C,C") throw new Error(labels.join());
  await lane.getByTestId("stem-section").nth(1).click();
  await player().getByTestId("stem-time").getByText("0:05 / ").waitFor();
  await player().getByTestId("stem-time-section").getByText("Chorus").waitFor();
  await lane.locator('[aria-current="step"]').getByText("C").waitFor();
  const line = await player().getByTestId("stem-playhead").evaluate((input) => input.style.getPropertyValue("--sections"));
  if (!line.includes("--color-sky-500") || !line.includes("--color-amber-400")) throw new Error(line);
  // Minimized, the line keeps its colours.
  await player().getByTestId("stem-minimize").click();
  if (!(await player().getByTestId("stem-playhead").evaluate((input) => input.style.getPropertyValue("--sections")))) throw new Error("no colours minimized");
});

await step("the sections' handles (issue #110): shown on hover, dragged as in a video editor, nudged by key, never past a neighbour", async () => {
  await player().getByRole("button", { name: "Expand the player" }).click();
  await player().getByTestId("stem-cues").click();
  const editor = player().getByTestId("stem-cue-editor");
  await editor.waitFor();
  const lane = player().getByTestId("stem-sections-lane");
  const handle = (index) => lane.locator(`[data-testid="stem-cue-handle"][data-index="${index}"]`);
  // Hidden until the strip is hovered.
  if ((await handle(1).evaluate((el) => getComputedStyle(el).opacity)) !== "0") throw new Error("a handle shown before hovering");
  await lane.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="stem-cue-handle"][data-index="1"]')).opacity === "1");
  // Dragged with Alt (not snapped): the chorus from 0:05 to about 0:08.
  const box = await lane.boundingBox();
  const duration = Number(await player().getByRole("slider", { name: "Position" }).getAttribute("max"));
  const x = (seconds) => box.x + (seconds / duration) * box.width;
  const grip = await handle(1).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(x(6.5), grip.y + grip.height / 2, { steps: 5 });
  await lane.getByTestId("stem-cue-drag-time").waitFor();
  await page.mouse.move(x(8), grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const timeOf = async (index) => parseFloat((await editor.getByTestId("stem-cue-time").nth(index).inputValue()).split(":")[1]);
  let moved = await timeOf(1);
  if (Math.abs(moved - 8) > 0.3) throw new Error(`dragged to ${moved}`);
  // Nudged: Shift+Right, 10 ms later.
  await handle(1).focus();
  await page.keyboard.press("Shift+ArrowRight");
  const nudged = await timeOf(1);
  if (Math.abs(nudged - moved - 0.01) > 0.002) throw new Error(`${moved} -> ${nudged}`);
  // Dragged past the next one (0:12.5): stops just short of it.
  const again = await handle(1).boundingBox();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(x(20), again.y + again.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  moved = await timeOf(1);
  if (moved >= 12.5 || moved < 12.3) throw new Error(`past its neighbour: ${moved}`);
  if ((await lane.getByTestId("stem-section").allInnerTexts()).map((label) => label.trim()).join() !== "V,C,C") throw new Error("the order changed");
  await editor.getByTestId("stem-cue-save").click();
  await editor.waitFor({ state: "detached", timeout: 15000 });
  const files = await api(me, "GET", `/song-versions/${cued.id}/attachments`);
  const second = files[0].cuePoints[1].at;
  if (Math.abs(second - moved) > 0.001) throw new Error(`saved ${second}, dragged to ${moved}`);
  // Closed, no handles.
  if (await lane.getByTestId("stem-cue-handle").count()) throw new Error("handles without the editor");
});

await browser.close();
finish();
