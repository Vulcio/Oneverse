// A song's tempo where it's played (issue #382): in Practice, one's own for
// practising, a tap away and back to the song's whenever; in a set, the
// set's own, set by its editors. The song keeps its tempo either way. The
// suites can't hear the metronome: they read the clicks it scheduled
// (window.songverseMetronome).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Tempo");
const song = await api(me, "POST", "/song-versions", { title: `Steady ${stamp}`, language: "en", artists: ["Band"], tempo: 100, timeSignature: "4/4", content: "[G]One two [C]three four\n", contentFormat: "CHORDPRO" });
const set = await api(me, "POST", "/setlists", { name: `Sunday ${stamp}` });
const { items } = await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const item = items.find((one) => one.song?.id === song.id);
const songTempo = async () => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson.defaults.tempo;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));

/** Seconds between the clicks scheduled from a moment on, once there are a few. */
async function gaps() {
  const from = await page.evaluate(() => (window.songverseMetronome?.now() ?? 0) + 0.3);
  await page.waitForFunction((at) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.time >= at).length >= 4, from, { timeout: 15000 });
  const list = await page.evaluate((at) => window.songverseMetronome.clicks.filter((c) => c.time >= at), from);
  return list.slice(1).map((c, i) => Math.round((c.time - list[i].time) * 1000) / 1000);
}
const every = (list, value) => list.length > 0 && list.every((gap) => Math.abs(gap - value) < 0.002);
/** Waits for the control to show a tempo. */
const shows = (id, tempo) => page.locator(`[data-testid="${id}"][data-tempo="${tempo}"]`).waitFor({ timeout: 10000 });

await step("Practice: the BPM, tapped, goes faster for me; the metronome plays it; it's kept", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("practice-tempo").click();
  const panel = page.getByTestId("practice-tempo-panel");
  for (let i = 0; i < 20; i++) await panel.getByTestId("practice-tempo-faster").click();
  await shows("practice-tempo", 120);
  await page.keyboard.press("Escape");
  // Saved with my chart preferences, a moment after the last tap.
  for (let i = 0; i < 30 && (await api(me, "GET", `/chart-preferences?songVersionId=${song.id}`)).tempo !== 120; i++) await page.waitForTimeout(200);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await shows("practice-tempo", 120);
  await page.locator('[data-testid="practice-tempo"][data-changed]').waitFor();
  await page.getByTestId("bars-metronome").click();
  const list = await gaps();
  if (!every(list, 0.5)) throw new Error(`not 120 BPM: ${list}`);
  await page.getByTestId("bars-metronome").click();
  if ((await songTempo()) !== 100) throw new Error("the song's tempo changed");
});

await step("back to the song's tempo, from the same place", async () => {
  await page.getByTestId("practice-tempo").click();
  await page.getByTestId("practice-tempo-reset").click();
  await shows("practice-tempo", 100);
  for (let i = 0; i < 30 && (await api(me, "GET", `/chart-preferences?songVersionId=${song.id}`)).tempo != null; i++) await page.waitForTimeout(200);
  if ((await api(me, "GET", `/chart-preferences?songVersionId=${song.id}`)).tempo != null) throw new Error("still mine");
  await page.keyboard.press("Escape");
});

await step("a set: its own tempo for the song, typed in; the song keeps its own", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.waitForLoadState("networkidle");
  await shows("set-tempo", 100);
  await page.getByTestId("set-tempo").click();
  await page.getByTestId("set-tempo-input").fill("75");
  await page.getByTestId("set-tempo-input").press("Enter");
  await shows("set-tempo", 75);
  for (let i = 0; i < 30 && (await api(me, "GET", `/setlists/${set.id}`)).items[0].tempoOverride !== 75; i++) await page.waitForTimeout(200);
  if ((await api(me, "GET", `/setlists/${set.id}`)).items[0].tempoOverride !== 75) throw new Error("not saved on the set");
  if ((await songTempo()) !== 100) throw new Error("the song's tempo changed");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await shows("set-tempo", 75);
  // The set's song page plays it at the set's tempo.
  await page.getByTestId("metronome-dock-play").click();
  const list = await gaps();
  if (!every(list, 0.8)) throw new Error(`not 75 BPM: ${list}`);
  await page.getByTestId("metronome-dock-play").click();
});

await step("the set's tempo cleared: the song's again", async () => {
  await page.getByTestId("set-tempo").click();
  await page.getByTestId("set-tempo-reset").click();
  await shows("set-tempo", 100);
  for (let i = 0; i < 30 && (await api(me, "GET", `/setlists/${set.id}`)).items[0].tempoOverride !== null; i++) await page.waitForTimeout(200);
  if ((await api(me, "GET", `/setlists/${set.id}`)).items[0].tempoOverride !== null) throw new Error("still the set's");
});

await step("the API refuses a tempo out of range", async () => {
  const answer = await api(me, "PATCH", `/setlists/${set.id}/items/${item.id}`, { tempoOverride: 500 }).catch((error) => error);
  if (!String(answer?.message ?? answer).includes("tempoOverride")) throw new Error(JSON.stringify(answer));
});

await browser.close();
finish();
