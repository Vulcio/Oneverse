// Sync play (issue #13), in two browsers: a follower and a leader in a
// team's set, in Live. The leader starts the metronome: the follower hears
// the same beats at the same instants (each click's time as heard, on each
// device's clock, compared); a new tempo reaches them in time; the leader's
// next song opens on the follower's screen; a follower's metronome is the
// leader's (only sound and volume their own); a reload rejoins, the
// leader's included (still leading, still in time); ending the session
// stops everyone's. A change to the set, and the songs the leader played,
// reach the follower at once (issue #200). The suites can't hear it: they read the clicks the
// engine scheduled (window.songverseMetronome).
import { chromium } from "playwright";
import { WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const leaderUser = await user("Leader");
const followerUser = await user("Follower");
const team = await api(leaderUser, "POST", "/teams", { name: `Band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmsp${stamp}', '${team.id}', '${followerUser.id}', 'MEMBER', now())`);
const song = (title, tempo) => api(leaderUser, "POST", "/song-versions", { title, language: "en", artists: ["Band"], tempo, teamId: team.id, content: "[G]Line\n", contentFormat: "CHORDPRO" });
const first = await song(`First ${stamp}`, 90);
const second = await song(`Second ${stamp}`, 120);
const set = await api(leaderUser, "POST", "/setlists", { name: `Sunday ${stamp}`, teamId: team.id });
await api(leaderUser, "POST", `/setlists/${set.id}/items`, { songVersionId: first.id });
await api(leaderUser, "POST", `/setlists/${set.id}/items`, { songVersionId: second.id });
const [item1, item2] = (await api(leaderUser, "GET", `/setlists/${set.id}`)).items;

const browser = await chromium.launch();
const open = async (who, init) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (init) await context.addInitScript(init);
  const p = await context.newPage();
  await signIn(p, who);
  return p;
};
// The follower's audio output timestamp is on another timeline, ten minutes
// off, as an iPad 6th gen's on iOS 17 seems to be (issue #102): it mustn't be believed.
const follower = await open(followerUser, () => {
  const real = AudioContext.prototype.getOutputTimestamp;
  AudioContext.prototype.getOutputTimestamp = function () {
    const stamp = real.call(this);
    return { contextTime: stamp.contextTime, performanceTime: stamp.performanceTime ? stamp.performanceTime + 600000 : 0 };
  };
});
const leader = await open(leaderUser);
page = follower;

const control = (p) => p.getByTestId("sync-control").first();
const menu = (p) => p.getByTestId("sync-menu");
async function choose(p, item) {
  await control(p).click();
  await menu(p).getByRole("menuitem", { name: item }).click();
}
const syncState = (p, value) => p.locator(`[data-testid="sync-control"][data-state-sync="${value}"]`).first().waitFor({ timeout: 10000 });

/** Each click as heard: its position in the timeline, and when (ms since the epoch, on the device's clock). */
const heard = (p) => p.evaluate(() => {
  const m = window.songverseMetronome;
  return (m?.clicks ?? []).map((c) => ({ position: c.position, at: c.heardAt, output: c.outputAt, clock: c.clockAt }));
});
/** Waits for the follower's clicks from now on, and compares them with the leader's at the same positions: the most they're apart (ms). */
async function apart(count = 6) {
  const since = Date.now();
  await follower.waitForFunction(([n, s]) => {
    const m = window.songverseMetronome;
    return (m?.clicks ?? []).filter((c) => c.heardAt > s).length >= n;
  }, [count, since], { timeout: 15000 });
  // Only clicks already heard: each device schedules a little ahead, not always as far as the other yet.
  await follower.waitForTimeout(300);
  const [mine, theirs] = await Promise.all([heard(follower), heard(leader)]);
  const heardBy = Date.now();
  const recent = mine.filter((c) => c.at > since && c.at < heardBy);
  const pairs = recent.map((c) => [c, theirs.filter((l) => Math.abs(l.position - c.position) < 1e-6).sort((a, b) => Math.abs(a.at - c.at) - Math.abs(b.at - c.at))[0]]);
  // Too few clicks to compare is a failure, not "nothing apart".
  const worstOf = (key) => (pairs.length < 3 ? Infinity : Math.max(...pairs.map(([c, l]) => (l ? Math.abs(l[key] - c[key]) : Infinity))));
  // `worst`: the timelines each device plays, on its own clock - what Sync play keeps together. `output`: the same through each
  // one's audio output, as it reports it: a headless browser's stand-in output is off by an audio buffer or two (10 ms each)
  // after a reload, so only a loose bound here; a real device's output says when it plays.
  // `clock`: the same by each one's audio clock, read against its device clock (a block's jitter each) - which a wrong output timestamp can't hide (issue #102).
  return { worst: worstOf("at"), output: worstOf("output"), clock: worstOf("clock"), recent };
}
const gapsOf = (clicks) => clicks.slice(1).map((c, i) => c.at - clicks[i].at);

await step("the follower opens Live: in the live session by default (issue #561), no one leads yet, and they can't", async () => {
  // Sync details on (issue #101), to see the skewed timestamp refused.
  await follower.goto(`${WEB}/sets/${set.id}/live/${item1.id}?debug=sync`);
  await syncState(follower, "on");
  await control(follower).click();
  await menu(follower).getByText("Waiting for someone who can edit the set to lead.").waitFor();
  if (await menu(follower).getByRole("menuitem", { name: "Lead the set" }).count()) throw new Error("a member can lead");
  await follower.keyboard.press("Escape");
});

await step("the leader opens Live and leads: the follower follows them", async () => {
  page = leader;
  await leader.goto(`${WEB}/sets/${set.id}/live/${item1.id}`);
  await syncState(leader, "on");
  await choose(leader, "Lead the set");
  await syncState(leader, "leading");
  page = follower;
  await syncState(follower, "following");
  await control(follower).click();
  await menu(follower).getByText("Leader is leading").waitFor();
  await menu(follower).getByTestId("sync-members").getByText("2 devices in sync").waitFor();
  await follower.keyboard.press("Escape");
});

await step("the leader starts the metronome: the follower hears the same beats at the same instants", async () => {
  page = leader;
  await leader.getByTestId("metronome-song").click();
  page = follower;
  const { worst, output, clock, recent } = await apart();
  check("in time with the leader (ms apart, at most)", worst < 5 && output < 40 && clock < 60, `${worst.toFixed(2)} ms (output ${output.toFixed(2)} ms, audio clock ${clock.toFixed(2)} ms)`);
  if (!gapsOf(recent).every((gap) => Math.abs(gap - 60000 / 90) < 3)) throw new Error(`gaps ${gapsOf(recent)}`);
  // The follower's skewed output timestamp, refused: Sync details says so.
  await follower.getByTestId("sync-details").getByText(/output timestamp not used \(\d+ readings refused\)/).first().waitFor();
  // The follower's button is the leader's metronome.
  if ((await follower.getByTestId("metronome-song").getAttribute("title")) !== "Following Leader") throw new Error("not the leader's");
});

await step("the leader's next song opens on the follower's screen", async () => {
  page = leader;
  await leader.getByTestId("live-next").click();
  await leader.waitForURL(new RegExp(`/live/${item2.id}$`));
  page = follower;
  await follower.waitForURL(new RegExp(`/live/${item2.id}$`), { timeout: 10000 });
});

await step("the leader's changes to the set and the songs they played reach the follower at once (issue #200)", async () => {
  const songs = (p) => p.getByTestId("sidebar-set-song");
  // The first song fits the screen: played once the leader moved on from it.
  page = follower;
  await songs(follower).first().getByTestId("sidebar-played").waitFor({ timeout: 10000 });
  // Play next, from the leader: in the follower's list straight away, and Live's next is it - no song change needed.
  const third = await song(`Third ${stamp}`, 100);
  await api(leaderUser, "POST", `/setlists/${set.id}/items`, { songVersionId: third.id, afterItemId: item1.id });
  await songs(follower).nth(1).getByText(`Third ${stamp}`).waitFor({ timeout: 10000 });
  if ((await songs(follower).count()) !== 3) throw new Error("not three songs");
  // Only the leader starts from the top, for everyone: the follower's ticks go with theirs.
  if (await follower.getByTestId("sidebar-reset-played").count()) throw new Error("a follower can start from the top");
  page = leader;
  await leader.getByTestId("sidebar-reset-played").click();
  page = follower;
  await songs(follower).first().getByTestId("sidebar-played").waitFor({ state: "detached", timeout: 10000 });
  // Taken back out: gone from the follower's list too.
  const added = (await api(leaderUser, "GET", `/setlists/${set.id}`)).items.find((item) => item.song?.id === third.id);
  await api(leaderUser, "DELETE", `/setlists/${set.id}/items/${added.id}`);
  await follower.getByTestId("sidebar-set-song").getByText(`Third ${stamp}`).waitFor({ state: "detached", timeout: 10000 });
});

await step("a new tempo from the leader's Metronome page: the follower's changes with it, in time", async () => {
  page = leader;
  await leader.getByRole("link", { name: "Metronome", exact: true }).first().click();
  await leader.waitForURL(`${WEB}/metronome`);
  const tempo = leader.getByTestId("metronome-tempo");
  await tempo.fill("100");
  await tempo.blur();
  page = follower;
  await follower.waitForTimeout(1500);
  const { worst, output, clock, recent } = await apart();
  check("still in time after the change (ms apart, at most)", worst < 5 && output < 40 && clock < 60, `${worst.toFixed(2)} ms (output ${output.toFixed(2)} ms, audio clock ${clock.toFixed(2)} ms)`);
  if (!gapsOf(recent).every((gap) => Math.abs(gap - 600) < 3)) throw new Error(`gaps ${gapsOf(recent)}`);
});

await step("the follower's Metronome page: the leader's, but for their sound and volume; back after a reload", async () => {
  page = follower;
  await follower.goto(`${WEB}/metronome`);
  await follower.getByTestId("metronome-following").getByText("Leader leads the metronome").waitFor({ timeout: 10000 });
  if (!(await follower.getByTestId("metronome-tempo").isDisabled())) throw new Error("the tempo can be changed");
  if (!(await follower.getByTestId("metronome-play").isDisabled())) throw new Error("it can be stopped");
  if (await follower.getByLabel("Sound").isDisabled()) throw new Error("the sound can't be chosen");
  await follower.waitForFunction(() => document.querySelector('[data-testid="metronome-tempo"]')?.value === "100", null, { timeout: 10000 });
  // A reload: the browser may want a press before it makes a sound.
  const tap = follower.getByRole("button", { name: "Tap to hear the metronome" });
  if (await tap.isVisible()) await tap.click();
  const { worst, output, clock } = await apart();
  check("in time after the follower's reload (ms apart, at most)", worst < 5 && output < 40 && clock < 60, `${worst.toFixed(2)} ms (output ${output.toFixed(2)} ms, audio clock ${clock.toFixed(2)} ms)`);
});

await step("the leader reloads: still leading, the metronome picked up where it is", async () => {
  page = leader;
  await leader.reload();
  await leader.getByTestId("metronome-tempo").waitFor();
  const tap = leader.getByRole("button", { name: "Tap to hear the metronome" });
  await leader.waitForFunction(() => (window.songverseMetronome?.clicks ?? []).length > 0, null, { timeout: 10000 });
  if (await tap.isVisible()) await tap.click();
  page = follower;
  const { worst, output, clock } = await apart();
  check("in time after the leader's reload (ms apart, at most)", worst < 5 && output < 40 && clock < 60, `${worst.toFixed(2)} ms (output ${output.toFixed(2)} ms, audio clock ${clock.toFixed(2)} ms)`);
  await follower.getByTestId("metronome-following").waitFor();
});

await step("the follower follows to the section, leaves, and stays out until they join again (issue #561)", async () => {
  page = follower;
  await follower.goto(`${WEB}/sets/${set.id}/live/${item1.id}`);
  await syncState(follower, "following");
  await control(follower).click();
  await menu(follower).locator('[data-testid="sync-level-line"][aria-checked="true"]').waitFor();
  await menu(follower).getByTestId("sync-level-section").click();
  await menu(follower).locator('[data-testid="sync-level-section"][aria-checked="true"]').waitFor();
  await menu(follower).getByTestId("sync-leave").click();
  await syncState(follower, "off");
  await follower.reload();
  await follower.getByTestId("sync-control").first().waitFor();
  await follower.waitForTimeout(1500);
  await syncState(follower, "off");
  await choose(follower, "Join the live session");
  await syncState(follower, "following");
  // Joined again: down to the line, as by default.
  await control(follower).click();
  await menu(follower).locator('[data-testid="sync-level-line"][aria-checked="true"]').waitFor();
  await follower.keyboard.press("Escape");
  // Back on the Metronome page, for the end.
  await follower.goto(`${WEB}/metronome`);
  await follower.getByTestId("metronome-following").waitFor();
});

await step("the leader ends the session: everyone's metronome stops", async () => {
  page = leader;
  await leader.goto(`${WEB}/sets/${set.id}`);
  await choose(leader, "End the session");
  page = follower;
  await follower.getByTestId("metronome-following").waitFor({ state: "detached", timeout: 10000 });
  const count = await follower.evaluate(() => window.songverseMetronome.clicks.length);
  await follower.waitForTimeout(1500);
  if ((await follower.evaluate(() => window.songverseMetronome.clicks.length)) !== count) throw new Error("still clicking");
  if (!(await follower.getByTestId("metronome-play").isEnabled())) throw new Error("still locked");
});

await browser.close();
finish();
