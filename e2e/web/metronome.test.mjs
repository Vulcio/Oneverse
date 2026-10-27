// The metronome (issue #2), in the browser: its page from the sidebar -
// tempo, tap tempo, the pattern, subdivisions, a count-in - kept going on
// other pages with a way back; Live's button at the song's tempo and time
// signature. The suites can't hear it: they read the clicks the engine
// scheduled on the audio clock (window.songverseMetronome).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Drummer");
const waltz = await api(me, "POST", "/song-versions", { title: `Waltz ${stamp}`, language: "en", artists: ["Band"], tempo: 72, timeSignature: "3/4", content: "[G]One two three\n", contentFormat: "CHORDPRO" });
const loose = await api(me, "POST", "/song-versions", { title: `No tempo ${stamp}`, language: "en", artists: ["Band"], content: "[G]Free\n", contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);

/** The clicks scheduled since `since` (audio clock), once there are at least `count`. */
async function clicks(count, since = 0) {
  await page.waitForFunction(
    ([n, from]) => (window.songverseMetronome?.clicks ?? []).filter((c) => c.time >= from).length >= n,
    [count, since],
    { timeout: 15000 },
  );
  return page.evaluate((from) => window.songverseMetronome.clicks.filter((c) => c.time >= from), since);
}
const now = () => page.evaluate(() => window.songverseMetronome?.now() ?? 0);
/** Seconds between clicks, rounded to the millisecond. */
const gaps = (list) => list.slice(1).map((c, i) => Math.round((c.time - list[i].time) * 1000) / 1000);
const same = (list, value) => list.length > 0 && list.every((gap) => Math.abs(gap - value) < 0.002);

await step("the Metronome page, from the sidebar: it starts at 100 BPM in 4/4, the first beat accented", async () => {
  await page.getByRole("link", { name: "Metronome", exact: true }).click();
  await page.waitForURL(`${WEB}/metronome`);
  await page.getByTestId("metronome-play").click();
  const list = await clicks(6);
  if (!same(gaps(list), 0.6)) throw new Error(`gaps ${gaps(list)}`);
  const levels = list.slice(0, 5).map((c) => `${c.beat}:${c.level}`).join(" ");
  if (levels !== "0:accent 1:normal 2:normal 3:normal 0:accent") throw new Error(levels);
  // The light on the beat being heard.
  await page.getByTestId("metronome-beats").locator("[data-lit]").waitFor();
  await page.getByTestId("metronome-bar").getByText(/^Bar \d+$/).waitFor();
});

await step("a new tempo takes over on the next beat; the arrows change it too", async () => {
  const tempo = page.getByTestId("metronome-tempo");
  await tempo.fill("120");
  await tempo.blur();
  const from = (await now()) + 0.8;
  if (!same(gaps(await clicks(4, from)), 0.5)) throw new Error("not at 120");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Shift+ArrowDown");
  if ((await tempo.inputValue()) !== "116") throw new Error(await tempo.inputValue());
  await page.getByRole("button", { name: "Faster" }).click();
  if ((await tempo.inputValue()) !== "117") throw new Error(await tempo.inputValue());
});

await step("the pattern: a beat clicked twice goes silent; triplets between the beats", async () => {
  await page.getByTestId("metronome-tempo").fill("120");
  const second = page.getByRole("button", { name: "Beat 2: normal" });
  await second.click();
  await page.getByRole("button", { name: "Beat 2: silent" }).waitFor();
  await page.getByLabel("Subdivision").selectOption({ label: "Triplets" });
  const list = await clicks(12, (await now()) + 0.8);
  if (list.some((c) => c.beat === 1)) throw new Error("beat 2 still sounds");
  const onBeat = list.filter((c) => c.beat === 0);
  if (!onBeat.some((c) => c.sub === 1) || !onBeat.some((c) => c.sub === 2)) throw new Error("no triplets");
  if (!same(gaps(list.filter((c) => c.beat === 2)), 0.5 / 3)) throw new Error(`gaps ${gaps(list.filter((c) => c.beat === 2))}`);
  // Back to plain beats, every one sounding.
  await page.getByLabel("Subdivision").selectOption({ label: "None" });
  await page.getByRole("button", { name: "Beat 2: silent" }).click();
});

await step("a count-in of a bar, then silent: the beat still shows", async () => {
  await page.getByTestId("metronome-play").click();
  await page.getByLabel("Count-in", { exact: true }).selectOption({ label: "1 bar" });
  await page.getByLabel("Count-in only").check();
  const from = await now();
  await page.getByTestId("metronome-play").click();
  await page.getByTestId("metronome-bar").getByText("Count-in").waitFor();
  const list = await clicks(4, from);
  if (list.some((c) => c.bar >= 0) || list.length !== 4) throw new Error(JSON.stringify(list));
  await page.getByTestId("metronome-bar").getByText("Bar 1").waitFor();
  await page.waitForTimeout(700);
  const after = await page.evaluate((f) => window.songverseMetronome.clicks.filter((c) => c.time >= f).length, from);
  if (after !== 4) throw new Error(`${after} clicks`);
  await page.getByTestId("metronome-play").click();
  await page.getByLabel("Count-in", { exact: true }).selectOption({ label: "None" });
});

await step("it keeps going on other pages, with its tempo there, a way back and a stop", async () => {
  await page.getByTestId("metronome-play").click();
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await page.waitForURL(`${WEB}/library`);
  const back = page.getByTestId("metronome-return");
  await back.getByText("120 BPM").waitFor();
  await back.getByRole("link", { name: "Metronome settings" }).click();
  await page.waitForURL(`${WEB}/metronome`);
  if (await back.count()) throw new Error("shown on its own page");
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await back.getByRole("button", { name: "Stop" }).click();
  await back.waitFor({ state: "detached" });
});

await step("the settings are kept for next time", async () => {
  await page.goto(`${WEB}/metronome`);
  // Read once the page is in the browser (the server can't know them).
  await page.waitForFunction(() => document.querySelector('[data-testid="metronome-tempo"]')?.value === "120", null, { timeout: 5000 });
});

await step("Live: one button, at the song's tempo and time signature; a song without a tempo can't", async () => {
  await page.goto(`${WEB}/library/${waltz.id}/live`);
  // A click before the page has hydrated does nothing.
  await page.waitForLoadState("networkidle");
  const button = page.getByTestId("metronome-song");
  await button.click();
  await page.locator('[data-testid="metronome-song"][aria-pressed="true"]').waitFor({ timeout: 5000 }).catch(() => {
    throw new Error("not pressed");
  });
  const list = await clicks(7, await now());
  if (!same(gaps(list), 60 / 72) || Math.max(...list.map((c) => c.beat)) !== 2) throw new Error(`gaps ${gaps(list)}`);
  await page.getByRole("button", { name: "Stop the metronome" }).click();
  if ((await button.getAttribute("aria-pressed")) !== "false") throw new Error("still pressed");
  await page.goto(`${WEB}/library/${loose.id}/live`);
  if (!(await page.getByRole("button", { name: "This song has no tempo" }).isDisabled())) throw new Error("enabled without a tempo");
});

await browser.close();
finish();
