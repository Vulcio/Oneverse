// Sync play with stems (issue #100), in two browsers on a set's song page
// in Practice: the leader plays the song's stems, and the follower's play
// from the same instant (the recording's 0:00 placed at the same time on
// each device's clock); pause and seek follow; the follower's play button
// is the leader's. The metronome with the recording: its bar 1 on the
// recording's first beat, at its tempo - the same on the follower's - and
// clicking from 0:00 on that beat, unless the recording's intro is free
// (issue #178).
import { chromium } from "playwright";
import { API, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

/** A minute of a quiet tone, as a WAV (8 kHz, 16-bit, mono): long enough to play, seek and click along with. */
function wav(frequency, seconds = 60, rate = 8000) {
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
const leaderUser = await user("Leader");
const followerUser = await user("Follower");
const team = await api(leaderUser, "POST", "/teams", { name: `Stems band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmss${stamp}', '${team.id}', '${followerUser.id}', 'MEMBER', now())`);
const song = await api(leaderUser, "POST", "/song-versions", { title: `Stems ${stamp}`, language: "en", artists: ["Band"], tempo: 90, teamId: team.id, content: "[G]Line\n", contentFormat: "CHORDPRO" });
for (const [name, part, frequency] of [["Drums.wav", "DRUMS", 220], ["Bass.wav", "BASS", 110]]) {
  const form = new FormData();
  form.append("type", "AUDIO");
  form.append("stemPart", part);
  // Everyone who sees the song hears them (issue #72).
  form.append("visibility", "SONG");
  form.append("file", new Blob([wav(frequency)], { type: "audio/wav" }), name);
  const res = await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${leaderUser.bearer}` }, body: form });
  const file = await res.json();
  // The recording: 120 BPM, its first beat half a second in.
  await api(leaderUser, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { recordingTempo: 120, recordingFirstBeat: 0.5 });
}
const set = await api(leaderUser, "POST", "/setlists", { name: `Stems set ${stamp}`, teamId: team.id });
await api(leaderUser, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const [item] = (await api(leaderUser, "GET", `/setlists/${set.id}`)).items;
const songPage = `${WEB}/sets/${set.id}/songs/${item.id}`;

const browser = await chromium.launch();
const open = async (who) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  await signIn(p, who);
  await p.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  return p;
};
const follower = await open(followerUser);
const leader = await open(leaderUser);
page = follower;

const control = (p) => p.getByTestId("sync-control").first();
async function choose(p, item) {
  await control(p).click();
  await p.getByTestId("sync-menu").getByRole("menuitem", { name: item }).click();
}
const player = (p) => p.getByTestId("stem-player");
const playerIn = (p, state) => p.locator(`[data-testid="stem-player"][data-state="${state}"]`);
/** The last start's 0:00 on the device's clock (ms), once there's one after `since`. */
async function zero(p, since) {
  await p.waitForFunction((s) => (window.songverseStems?.starts ?? []).some((x) => x.at > s), since, { timeout: 20000 });
  return p.evaluate(() => window.songverseStems.starts.at(-1).zeroAt);
}

await step("both on the set's song page, sync on, the leader leading", async () => {
  await follower.goto(songPage);
  await player(follower).waitFor();
  await choose(follower, "Turn sync on");
  page = leader;
  await leader.goto(songPage);
  await player(leader).waitFor();
  await choose(leader, "Turn sync on");
  await leader.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
  await choose(leader, "Lead the set");
  page = follower;
  await follower.locator('[data-testid="sync-control"][data-state-sync="following"]').first().waitFor({ timeout: 10000 });
});

await step("the leader plays the stems: the follower's start at the same instant", async () => {
  const since = Date.now();
  page = leader;
  await playerIn(leader, "ready").waitFor({ timeout: 15000 });
  await leader.getByTestId("stem-play").click();
  await playerIn(leader, "playing").waitFor({ timeout: 15000 });
  page = follower;
  await playerIn(follower, "playing").waitFor({ timeout: 15000 });
  const [mine, theirs] = await Promise.all([zero(follower, since), zero(leader, since)]);
  check("the recording's 0:00 at the same instant (ms apart)", Math.abs(mine - theirs) < 5, `${Math.abs(mine - theirs).toFixed(2)} ms`);
  const play = follower.getByTestId("stem-play");
  if ((await play.getAttribute("title")) !== "Following Leader") throw new Error("the follower's play isn't the leader's");
});

await step("the leader pauses: the follower's pause", async () => {
  page = leader;
  await leader.getByTestId("stem-play").click();
  page = follower;
  await playerIn(follower, "ready").waitFor({ timeout: 10000 });
});

await step("the leader seeks and plays again: the follower's there too, at the same instant", async () => {
  page = leader;
  await player(leader).getByRole("button", { name: "Expand the player" }).click();
  await player(leader).getByRole("slider", { name: "Position" }).fill("2");
  const since = Date.now();
  await leader.getByTestId("stem-play").click();
  page = follower;
  await playerIn(follower, "playing").waitFor({ timeout: 10000 });
  const [mine, theirs] = await Promise.all([zero(follower, since), zero(leader, since)]);
  check("after a seek, the same instant (ms apart)", Math.abs(mine - theirs) < 5, `${Math.abs(mine - theirs).toFixed(2)} ms`);
  const position = Number((await follower.getByTestId("stem-time").innerText()).split("/")[0].trim().split(":")[1]);
  if (position < 2) throw new Error(`the follower's at ${position}s`);
});

await step("the metronome with the recording: bar 1 on its first beat, at its tempo; the follower's the same", async () => {
  page = leader;
  await leader.getByTestId("stem-click").click();
  const since = Date.now();
  await leader.waitForFunction((s) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.heardAt > s).length >= 4, since, { timeout: 15000 });
  const [clicks, start] = await leader.evaluate(() => [window.songverseMetronome.clicks, window.songverseStems.starts.at(-1)]);
  const recent = clicks.filter((c) => c.heardAt > since);
  // Beat n of the song falls at the first beat plus n half-seconds of the recording; the bar before it (issue #178) clicks from 0:00.
  const worst = Math.max(...recent.map((c) => {
    const n = c.position - 4;
    return Math.abs(c.heardAt - (start.zeroAt + (0.5 + n * 0.5) * 1000));
  }));
  check("the click on the recording's beat (ms off, at most)", worst < 2, `${worst.toFixed(2)} ms`);
  page = follower;
  await follower.waitForFunction((s) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.heardAt > s).length >= 4, since, { timeout: 15000 });
  const theirs = await follower.evaluate(() => window.songverseMetronome.clicks.map((c) => ({ position: c.position, at: c.heardAt })));
  const mine = new Map(recent.map((c) => [c.position, c.heardAt]));
  const apart = Math.max(...theirs.filter((c) => mine.has(c.position)).map((c) => Math.abs(c.at - mine.get(c.position))));
  check("the follower's click with it (ms apart, at most)", apart < 5, `${apart.toFixed(2)} ms`);
});

await step("the leader transposes (issue #129): the follower's stems transposed the same, still together", async () => {
  page = leader;
  const since = Date.now();
  await player(leader).getByRole("button", { name: "Up a semitone" }).click();
  await player(leader).getByRole("button", { name: "Up a semitone" }).click();
  await player(leader).locator('[data-testid="stem-transpose"][data-steps="2"]').waitFor();
  page = follower;
  await player(follower).getByRole("button", { name: "Expand the player" }).click();
  await player(follower).locator('[data-testid="stem-transpose"][data-steps="2"]').waitFor({ timeout: 10000 });
  if (!(await player(follower).getByRole("button", { name: "Up a semitone" }).isDisabled())) throw new Error("the follower's transposing isn't the leader's");
  // Transposing restarts the stems a little later (its latency made up): both the same instant again.
  await leader.waitForTimeout(1500);
  const [mine, theirs] = await Promise.all([zero(follower, since), zero(leader, since)]);
  // Each restart takes the clock pairing as it is then, which moves a few ms on its own; a
  // follower within 8 ms of where its clock says is left playing (REPLACE_BEYOND in
  // stem-engine.ts). Measured against the leader, the two pages' pairings with the server
  // add their own millisecond or two on top: up to 8 ms plus that is the engine working.
  check("transposed, the same instant (ms apart)", Math.abs(mine - theirs) < 10, `${Math.abs(mine - theirs).toFixed(2)} ms`);
});

await step("the leader slows to 80% (issue #139): the follower's at 80% too, still together; the click at the slowed beat", async () => {
  page = leader;
  const since = Date.now();
  for (let i = 0; i < 4; i++) await player(leader).getByTestId("stem-speed-down").click();
  await player(leader).locator('[data-testid="stem-speed"][data-speed="0.8"]').waitFor();
  page = follower;
  await player(follower).locator('[data-testid="stem-speed"][data-speed="0.8"]').waitFor({ timeout: 10000 });
  if (!(await player(follower).getByTestId("stem-speed-down").isDisabled())) throw new Error("the follower's speed isn't the leader's");
  await leader.waitForTimeout(1500);
  const [mine, theirs] = await Promise.all([zero(follower, since), zero(leader, since)]);
  check("slowed, the same instant (ms apart)", Math.abs(mine - theirs) < 5, `${Math.abs(mine - theirs).toFixed(2)} ms`);
  page = leader;
  const after = Date.now();
  await leader.waitForFunction((s) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.heardAt > s).length >= 4, after, { timeout: 15000 });
  const [clicks, start] = await leader.evaluate(() => [window.songverseMetronome.clicks, window.songverseStems.starts.at(-1)]);
  // Beat n now falls every 0.5 / 0.8 s of real time after the first beat's.
  const worst = Math.max(...clicks.filter((c) => c.heardAt > after).map((c) => {
    const n = c.position - 4;
    return Math.abs(c.heardAt - (start.zeroAt + ((0.5 + n * 0.5) / 0.8) * 1000));
  }));
  check("the click on the slowed beat (ms off, at most)", worst < 2, `${worst.toFixed(2)} ms`);
});

await step("the leader turns the click off and ends the session: the follower's stems stop", async () => {
  page = leader;
  await leader.getByTestId("stem-click").click();
  await choose(leader, "End the session");
  page = follower;
  await playerIn(follower, "ready").waitFor({ timeout: 10000 });
  if (await follower.getByTestId("stem-play").isDisabled()) throw new Error("still the leader's");
});

/** Plays the leader's stems from 0:00 with the click on; the clicks before the first beat (0.5 s in), and the start. */
async function fromTheStart() {
  page = leader;
  await leader.reload();
  await playerIn(leader, "ready").waitFor({ timeout: 15000 });
  await leader.getByTestId("stem-click").click();
  const since = Date.now();
  await leader.getByTestId("stem-play").click();
  await playerIn(leader, "playing").waitFor({ timeout: 15000 });
  await leader.waitForFunction((s) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.heardAt > s).length >= 4, since, { timeout: 15000 });
  const [clicks, start] = await leader.evaluate(() => [window.songverseMetronome.clicks, window.songverseStems.starts.at(-1)]);
  await leader.getByTestId("stem-play").click();
  return { start, early: clicks.filter((c) => c.heardAt > since && c.heardAt < start.zeroAt + 500 - 50) };
}

await step("the click from 0:00 (issue #178): the bar before the first beat on the same beat", async () => {
  const { start, early } = await fromTheStart();
  if (early.length === 0) throw new Error("no click before the first beat");
  const off = Math.max(...early.map((c) => Math.abs(c.heardAt - (start.zeroAt + (0.5 + (c.position - 4) * 0.5) * 1000))));
  check("before the first beat, on its beat (ms off, at most)", off < 2, `${off.toFixed(2)} ms`);
});

await step("a free intro: nothing before the first beat (no count-in set)", async () => {
  for (const file of await api(leaderUser, "GET", `/song-versions/${song.id}/attachments`)) {
    await api(leaderUser, "PATCH", `/song-versions/${song.id}/attachments/${file.id}`, { recordingFreeIntro: true });
  }
  const { early } = await fromTheStart();
  if (early.length > 0) throw new Error(`${early.length} clicks before the first beat`);
});

await browser.close();
finish();
