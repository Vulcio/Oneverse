// What plays with a song (issue #366): one control - the master, the
// video, the stems, the stems with the takes, the metronome, or nothing -
// with a default from what the song has, the person's choice kept on their
// account (so it follows them), loaded only once chosen, the next song of a
// set fetched ahead, the stems playing before they've all arrived, another
// source taking over from where the last one was, and Sync play's leader
// choosing for everyone.
import { chromium } from "playwright";
import { API, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { FAKE_YT } from "../lib/fake-youtube.mjs";

/** A quiet tone, as a WAV (8 kHz, 16-bit, mono). */
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
const me = await user("Player");
const singer = await user("Singer");
const team = await api(me, "POST", "/teams", { name: `Playback band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmpb${stamp}', '${team.id}', '${singer.id}', 'MEMBER', now())`);
const song = (title, fields = {}) => api(me, "POST", "/song-versions", { title, language: "en", artists: ["Band"], key: "G", teamId: team.id, content: "[G]Hello\n", contentFormat: "CHORDPRO", ...fields });
const upload = async (songId, name, part, frequency) => {
  const form = new FormData();
  form.append("type", "AUDIO");
  if (part) form.append("stemPart", part);
  form.append("visibility", "SONG");
  form.append("file", new Blob([wav(frequency)], { type: "audio/wav" }), name);
  const res = await fetch(`${API}/song-versions/${songId}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${await res.text()}`);
  return res.json();
};

// Everything: a master, stems (one of them a take recorded into them), a video, a tempo.
const full = await song(`Full ${stamp}`, { tempo: 96 });
const master = await upload(full.id, "Master.wav", null, 330);
const drums = await upload(full.id, "Drums.wav", "DRUMS", 220);
const bass = await upload(full.id, "Bass.wav", "BASS", 110);
const take = await upload(full.id, "Vocals take.wav", "VOCALS", 440);
sql(`update "Attachment" set origin = 'RECORDED' where id = '${take.id}'`);
await api(me, "PUT", `/song-versions/${full.id}/links/YOUTUBE`, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
// Only a tempo: the metronome plays by default.
const tempoOnly = await song(`Tempo ${stamp}`, { tempo: 120 });
// A set: the full song, then one with stems only.
const next = await song(`Next ${stamp}`, { tempo: 100 });
const nextDrums = await upload(next.id, "Next drums.wav", "DRUMS", 200);
const set = await api(me, "POST", "/setlists", { name: `Playback set ${stamp}`, teamId: team.id });
await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: full.id });
await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: next.id });
const [firstItem, secondItem] = (await api(me, "GET", `/setlists/${set.id}`)).items;

const browser = await chromium.launch();
const open = async (who) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  await signIn(p, who);
  await p.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_YT }));
  await p.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  await p.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  // Every file downloaded, by id.
  p.downloads = [];
  p.on("request", (request) => {
    const match = /\/attachments\/([^/]+)\/download/.exec(request.url());
    if (match) p.downloads.push(match[1]);
  });
  return p;
};
page = await open(me);
const control = (p = page) => p.getByTestId("playback-source");
const stems = (p = page) => p.getByTestId("stem-player");
const options = (p = page) => control(p).locator("option").evaluateAll((list) => list.map((option) => option.value));

await step("a song with everything offers each source, and plays its master by default", async () => {
  await page.goto(`${WEB}/library/${full.id}`);
  await control().waitFor();
  const offered = await options();
  check("the sources offered", JSON.stringify(offered) === JSON.stringify(["MASTER", "YOUTUBE", "STEMS", "TAKES", "METRONOME", "NONE"]), offered.join());
  check("the master by default", (await control().inputValue()) === "MASTER");
  check("nothing chosen yet", (await control().getAttribute("data-chosen")) === "");
  await stems().getByTestId("stem-recording-name").getByText("Master.wav").waitFor();
});

await step("the stems the person didn't choose aren't loaded: only the master, one quick file", async () => {
  await page.waitForLoadState("networkidle");
  const fetched = [...new Set(page.downloads)];
  check("only the master fetched", fetched.length === 1 && fetched[0] === master.id, fetched.join());
});

await step("choosing the stems: kept on the account, without the take", async () => {
  await control().selectOption("STEMS");
  await stems().getByTestId("stem-part-count").getByText("2 parts").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-source"]')?.dataset.chosen === "STEMS");
  // Saved on the server, for their other devices.
  await page.waitForTimeout(300);
  const saved = await api(me, "GET", `/chart-preferences?songVersionId=${full.id}`);
  check("saved with the chart preferences", saved.playback === "STEMS", JSON.stringify(saved));
});

await step("Play: the stems start before they've all arrived, and the first sound is timed", async () => {
  await stems().getByRole("button", { name: "Play", exact: true }).click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="stem-player"][data-complete="true"]').waitFor({ timeout: 15000 });
  const ms = await page.evaluate(() => window.songverseStems?.firstSoundMs);
  check("time to first sound measured", typeof ms === "number" && ms >= 0, `${ms} ms`);
  // Generous in CI: a headless browser on a shared machine; real targets are measured on devices.
  check("first sound within 5 s here", ms < 5000, `${ms} ms`);
});

await step("the takes: the vocals take joins, from where the stems were", async () => {
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => Number(document.querySelector('[data-testid="stem-player"] input[type="range"]')?.value ?? 0));
  await control().selectOption("TAKES");
  await stems().getByTestId("stem-part-count").getByText("3 parts").waitFor();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor({ timeout: 15000 });
  const after = await page.evaluate(() => Number(document.querySelector('[data-testid="stem-player"] input[type="range"]')?.value ?? 0));
  check("carried on, not from the start", after >= before && after > 0.5, `${before} -> ${after}`);
});

await step("metronome only: the stems stop, its own dock plays the song's tempo", async () => {
  await control().selectOption("METRONOME");
  await page.getByTestId("metronome-dock").getByText("96 BPM").waitFor();
  if (await stems().count()) throw new Error("the stem player is still docked");
  const playing = await page.evaluate(() => window.songverseStems?.starts !== undefined);
  check("the stems were loaded before", playing);
  await page.getByTestId("metronome-dock-play").click();
  await page.locator('[data-testid="metronome-dock"][data-state="playing"]').waitFor();
  const ms = await page.evaluate(() => window.songverseMetronomeStart?.firstSoundMs);
  check("the metronome starts at once", typeof ms === "number" && ms < 500, `${ms} ms`);
});

await step("nothing: no dock at all, and the metronome stops", async () => {
  await control().selectOption("NONE");
  await page.getByTestId("metronome-dock").waitFor({ state: "detached" });
  await page.getByTestId("metronome-return").waitFor({ state: "detached" });
  if (await stems().count()) throw new Error("a stem player for nothing");
  if (await page.getByTestId("youtube-dock").count()) throw new Error("a video for nothing");
});

await step("the video: its dock, and the choice survives a reload", async () => {
  await control().selectOption("YOUTUBE");
  await page.getByTestId("youtube-dock").waitFor();
  await page.waitForTimeout(300);
  await page.reload();
  await control().waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-source"]')?.value === "YOUTUBE");
  await page.getByTestId("youtube-dock").waitFor();
});

await step("a song with only a tempo: the metronome by default", async () => {
  await page.goto(`${WEB}/library/${tempoOnly.id}`);
  await control().waitFor();
  check("metronome by default", (await control().inputValue()) === "METRONOME");
  check("offers only the metronome and nothing", JSON.stringify(await options()) === JSON.stringify(["METRONOME", "NONE"]));
  await page.getByTestId("metronome-dock").getByText("120 BPM").waitFor();
});

await step("in a set: the next song's files are fetched ahead while this one's open", async () => {
  page.downloads = [];
  await page.goto(`${WEB}/sets/${set.id}/songs/${firstItem.id}`);
  await control().waitFor();
    // Once its files are listed: the set plays the song as written, so the choice made for the song is its.
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-source"]')?.value === "YOUTUBE");
  await page.waitForTimeout(3000);
  check("the next song's drums fetched ahead", page.downloads.includes(nextDrums.id), page.downloads.join());
  // Its Play then needs no download.
  page.downloads = [];
  await page.goto(`${WEB}/sets/${set.id}/songs/${secondItem.id}`);
  await control().waitFor();
});

await step("Sync play: the leader chooses for everyone, the others' control says so", async () => {
  const other = await open(singer);
  const choose = async (p, name) => {
    await p.getByTestId("sync-control").first().click();
    await p.getByTestId("sync-menu").getByRole("menuitem", { name }).click();
  };
  const songPage = `${WEB}/sets/${set.id}/songs/${firstItem.id}`;
  page = other;
  await other.goto(songPage);
  await control(other).waitFor();
  await choose(other, "Turn sync on");
  page = await open(me);
  const leader = page;
  await leader.goto(songPage);
  await control(leader).waitFor();
  await choose(leader, "Turn sync on");
  await leader.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
  await choose(leader, "Lead the set");
  // Only once it leads is its choice everyone's.
  await leader.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
  await other.locator('[data-testid="sync-control"][data-state-sync="following"]').first().waitFor({ timeout: 10000 });
  await control(leader).selectOption("METRONOME");
  page = other;
  await other.waitForFunction(() => document.querySelector('[data-testid="playback-source"]')?.dataset.leader === "METRONOME", null, { timeout: 10000 });
  check("the follower plays the leader's choice", (await control(other).inputValue()) === "METRONOME");
  check("and can't change it", await control(other).isDisabled());
  await other.getByTestId("playback-leader").waitFor();
  await other.getByTestId("metronome-dock").waitFor();
});

await browser.close();
finish();
