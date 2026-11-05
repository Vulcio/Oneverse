// The metronome (issue #2), in the browser: its page from the sidebar -
// tempo, tap tempo, the pattern, subdivisions, a count-in - kept going on
// other pages with a way back; Live's button at the song's tempo and time
// signature; the note the tempo counts (issue #377; 6/8 in quarters, issue #384); four beat levels, a
// pattern per time signature and a song version's own (issue #384). The suites can't hear it: they read the clicks the engine
// scheduled on the audio clock (window.songverseMetronome).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Drummer");
const waltz = await api(me, "POST", "/song-versions", { title: `Waltz ${stamp}`, language: "en", artists: ["Band"], tempo: 72, timeSignature: "3/4", content: "[G]One two three\n", contentFormat: "CHORDPRO" });
const jig = await api(me, "POST", "/song-versions", { title: `Jig ${stamp}`, language: "en", artists: ["Band"], tempo: 60, timeSignature: "6/8", content: "[D]One two three four five six\n", contentFormat: "CHORDPRO" });
const eighths = await api(me, "POST", "/song-versions", { title: `Eighths ${stamp}`, language: "en", artists: ["Band"], tempo: 180, tempoUnit: "1/8", timeSignature: "6/8", content: "[D]One\n", contentFormat: "CHORDPRO" });
const saved = async (song) => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson.defaults;
if ((await saved(eighths)).tempoUnit !== "1/8" || (await saved(jig)).tempoUnit) throw new Error(JSON.stringify([await saved(eighths), await saved(jig)]));
// A 7/8 version felt 3+2+2 (issue #384): its own pattern, whatever the player's.
const seven = await api(me, "POST", "/song-versions", { title: `Seven ${stamp}`, language: "en", artists: ["Band"], tempo: 120, timeSignature: "7/8", metronomeBeats: ["accent", "normal", "normal", "medium", "normal", "medium", "normal"], content: "[E]One\n", contentFormat: "CHORDPRO" });
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

await step("the pattern (issue #384): a click makes a beat accent, medium, small, off; triplets between the beats", async () => {
  await page.getByTestId("metronome-tempo").fill("120");
  await page.getByRole("button", { name: "Beat 3: small" }).click();
  await page.getByRole("button", { name: "Beat 3: off" }).click();
  await page.getByRole("button", { name: "Beat 3: accent" }).click();
  await page.getByRole("button", { name: "Beat 3: medium" }).waitFor();
  const levels = (await clicks(5, (await now()) + 0.8)).map((c) => `${c.beat}:${c.level}`);
  if (!levels.includes("2:medium") || levels.includes("2:accent")) throw new Error(levels.join(" "));
  await page.getByRole("button", { name: "Beat 2: small" }).click();
  await page.getByRole("button", { name: "Beat 2: off" }).waitFor();
  await page.getByLabel("Subdivision").selectOption({ label: "Triplets" });
  const list = await clicks(12, (await now()) + 0.8);
  if (list.some((c) => c.beat === 1)) throw new Error("beat 2 still sounds");
  const onBeat = list.filter((c) => c.beat === 0);
  if (!onBeat.some((c) => c.sub === 1) || !onBeat.some((c) => c.sub === 2)) throw new Error("no triplets");
  // Beat 3's triplets, in one bar: twelve clicks can run into the next bar's.
  const bars = [...new Set(list.filter((c) => c.beat === 2).map((c) => c.bar))];
  const whole = bars.find((bar) => list.filter((c) => c.beat === 2 && c.bar === bar).length === 3);
  const third = list.filter((c) => c.beat === 2 && c.bar === whole);
  if (!same(gaps(third), 0.5 / 3)) throw new Error(`gaps ${gaps(third)}`);
  // Back to plain beats, every one sounding.
  await page.getByLabel("Subdivision").selectOption({ label: "None" });
  await page.getByTestId("metronome-usual-pattern").click();
  await page.getByRole("button", { name: "Beat 2: small" }).waitFor();
  if (await page.getByTestId("metronome-usual-pattern").count()) throw new Error("still offered");
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

await step("Tempo in (issues #377, #384): 6/8 counts quarters, its fourth eighth medium; the note only sets the speed", async () => {
  await page.getByTestId("metronome-tempo").fill("120");
  await page.getByTestId("metronome-numerator").selectOption("6");
  await page.getByTestId("metronome-denominator").selectOption("8");
  const unit = page.getByTestId("metronome-tempo-unit");
  if ((await unit.inputValue()) !== "1/4") throw new Error(await unit.inputValue());
  await page.getByTestId("metronome-bpm-unit").getByText("BPM", { exact: true }).waitFor();
  await page.getByTestId("metronome-play").click();
  // 120 quarters: 240 eighths a minute, every one of the six dots, two groups of three.
  let list = await clicks(8, (await now()) + 0.3);
  if (!same(gaps(list), 0.25) || new Set(list.map((c) => c.beat)).size < 6) throw new Error(`quarters: ${list.map((c) => c.beat)} ${gaps(list)}`);
  const felt = [...new Map(list.map((c) => [c.beat, c.level])).entries()].sort(([a], [b]) => a - b).map(([, level]) => level).join(" ");
  if (felt !== "accent normal normal medium normal normal") throw new Error(felt);
  for (const [label, gap] of [["1/8", 0.5], ["1/4 dotted", 1 / 6], ["1/8 dotted", 1 / 3]]) {
    await unit.selectOption({ label });
    list = await clicks(6, (await now()) + 1.2);
    if (!same(gaps(list), gap) || new Set(list.map((c) => c.beat)).size < 5) throw new Error(`${label}: ${list.map((c) => c.beat)} ${gaps(list)}`);
  }
  // Every dot lights as it clicks.
  await unit.selectOption({ label: "1/8" });
  const lit = new Set();
  for (let i = 0; i < 40; i++) {
    const on = await page.getByTestId("metronome-beats").evaluate((el) => [...el.querySelectorAll("button")].findIndex((b) => b.hasAttribute("data-lit")));
    if (on >= 0) lit.add(on);
    await page.waitForTimeout(100);
  }
  if (lit.size < 6) throw new Error(`lit ${[...lit]}`);
  await page.getByTestId("metronome-play").click();
  // A pattern of the player's own for 6/8 (issue #384): 6/4 has its own, 6/8's comes back.
  await page.getByRole("button", { name: "Beat 2: small" }).click();
  await page.getByTestId("metronome-denominator").selectOption("4");
  await page.getByRole("button", { name: "Beat 2: small" }).waitFor();
  await page.getByRole("button", { name: "Beat 4: small" }).waitFor();
  await page.getByTestId("metronome-denominator").selectOption("8");
  await page.getByRole("button", { name: "Beat 2: off" }).waitFor();
  await page.getByTestId("metronome-usual-pattern").click();
  // Back to the usual note, then to 4/4: it takes 4/4's own.
  await unit.selectOption({ label: "1/4" });
  await page.getByTestId("metronome-numerator").selectOption("4");
  await page.getByTestId("metronome-denominator").selectOption("4");
  if ((await unit.inputValue()) !== "1/4") throw new Error(await unit.inputValue());
});

await step("a bar of 7 grouped 2+2+3, or 3+2+2 or 2+3+2 (issue #384)", async () => {
  await page.getByTestId("metronome-numerator").selectOption("7");
  await page.getByTestId("metronome-denominator").selectOption("8");
  const groupings = page.getByTestId("metronome-grouping");
  if ((await groupings.allTextContents()).join() !== "2+2+3,3+2+2,2+3+2") throw new Error((await groupings.allTextContents()).join());
  await page.locator('[data-testid="metronome-grouping"][aria-pressed="true"]', { hasText: "2+2+3" }).waitFor();
  await groupings.filter({ hasText: "3+2+2" }).click();
  await page.getByRole("button", { name: "Beat 4: medium" }).waitFor();
  await page.getByRole("button", { name: "Beat 3: small" }).waitFor();
  await page.getByTestId("metronome-usual-pattern").click();
  await page.getByTestId("metronome-numerator").selectOption("4");
  await page.getByTestId("metronome-denominator").selectOption("4");
  if (await groupings.count()) throw new Error("groupings in 4/4");
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
  // A 6/8 song at 60 (issue #384): a quarter a second, every eighth half of one apart, 1 and 4 marked.
  await page.goto(`${WEB}/library/${jig.id}/live`);
  await page.waitForLoadState("networkidle");
  await page.getByText("60 BPM").first().waitFor();
  if (await page.getByText("60 BPM ·").count()) throw new Error("a note shown for quarters");
  await button.click();
  let six = await clicks(7, await now());
  if (!same(gaps(six), 0.5) || new Set(six.map((c) => c.beat)).size < 6) throw new Error(`jig: ${six.map((c) => c.beat)} ${gaps(six)}`);
  if (six.find((c) => c.beat === 3)?.level !== "medium") throw new Error(`jig: ${six.map((c) => c.level)}`);
  await page.getByRole("button", { name: "Stop the metronome" }).click();
  // Told it counts eighths: 180 of them, as before.
  await page.goto(`${WEB}/library/${eighths.id}/live`);
  await page.waitForLoadState("networkidle");
  await button.click();
  six = await clicks(4, await now());
  if (!same(gaps(six), 60 / 180)) throw new Error(`eighths: ${gaps(six)}`);
  await page.getByRole("button", { name: "Stop the metronome" }).click();
  // A version's own pattern (issue #384): 7/8 felt 3+2+2.
  await page.goto(`${WEB}/library/${seven.id}/live`);
  await page.waitForLoadState("networkidle");
  await button.click();
  const bar = await clicks(8, await now());
  const sevenLevels = [...new Map(bar.map((c) => [c.beat, c.level])).entries()].sort(([a], [b]) => a - b).map(([, level]) => level).join(" ");
  if (sevenLevels !== "accent normal normal medium normal medium normal") throw new Error(sevenLevels);
  await page.getByRole("button", { name: "Stop the metronome" }).click();
  await page.goto(`${WEB}/library/${loose.id}/live`);
  if (!(await page.getByRole("button", { name: "This song has no tempo" }).isDisabled())) throw new Error("enabled without a tempo");
});

await browser.close();
finish();
