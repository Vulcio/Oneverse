// Chord diagrams (issue #207): off until the player picks an instrument in
// Chart display; then the song's chords as small diagrams at the top of its
// chart in Practice, a set's song and Live - the shape a guitarist frets with
// the capo on - folding to one line, and a chord's card, with its other
// shapes, when it's tapped on the chart. A set's "Hide chords" still hides.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, stamp, stepper, user, displaySetting, resetDisplay } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Chord player");
const song = await api(me, "POST", "/song-versions", {
  title: `Diagram Song ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "A",
  capo: 2,
  content: "{start_of_verse}\n[A]Amazing [D]grace how [E]sweet the [F#m]sound\n[A]That saved a [E]wretch like [A]me\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
const set = await api(me, "POST", "/setlists", { name: `Diagram Set ${stamp}` });
const item = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items[0];

check("off by default", (await api(me, "GET", "/users/me")).chordDiagrams === "OFF");
check("only an instrument it knows", (await call(me, "PATCH", "/users/me", { chordDiagrams: "BANJO" })).status === 400);

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));

/**
 * Chart display's Chord diagrams, on the dashboard, until the account has it:
 * a choice made as the page loads, before it's ready, changes nothing (a cold
 * server's first dashboard, in CI).
 */
async function chooseDiagrams(value) {
  for (let tries = 0; ; tries++) {
    await page.goto(`${WEB}/dashboard`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Chord diagrams").selectOption(value);
    await page.waitForLoadState("networkidle");
    const saved = (await api(me, "GET", "/users/me")).chordDiagrams;
    if (saved === value) return;
    if (tries === 2) throw new Error(saved);
  }
}

await step("no diagrams until the player picks an instrument", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByTestId("practice-song").waitFor();
  await page.locator('[data-chord="A"]').first().waitFor();
  if ((await page.getByTestId("chord-strip").count()) > 0) throw new Error("a strip with diagrams off");
});

await step("Chart display: guitar", async () => {
  await chooseDiagrams("GUITAR");
});

await step("Practice: the song's chords as a guitarist frets them with the capo on 2", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  const strip = page.getByTestId("chord-strip");
  await strip.waitFor();
  const chords = await strip.locator("[data-chord-diagram]").evaluateAll((els) => els.map((el) => el.dataset.chordDiagram));
  // A D E F#m sounding, capo 2: G C D Em shapes, each once, in the order they come.
  if (chords.join() !== "G,C,D,Em") throw new Error(chords.join());
  const g = await strip.locator('[data-chord-diagram="G"] svg').getAttribute("data-shape");
  if (g !== "320003") throw new Error(`G drawn as ${g}`);
  await strip.getByText("capo 2, shapes as played").waitFor();
  // The chart's own chords stay as they sound.
  await page.locator('[data-chord="F#m"]').first().waitFor();
});

await step("a chord tapped on the chart shows its card, with its other shapes", async () => {
  await page.getByRole("button", { name: "Show how to play D" }).first().click();
  const card = page.getByTestId("chord-card");
  await card.waitFor();
  // D sounding with the capo on 2: a C shape.
  if ((await card.getAttribute("data-chord")) !== "C") throw new Error(await card.getAttribute("data-chord"));
  const first = await card.locator("svg[data-shape]").getAttribute("data-shape");
  if (first !== "x32010") throw new Error(`C drawn as ${first}`);
  await card.getByRole("button", { name: "Next shape" }).click();
  const second = await card.locator("svg[data-shape]").getAttribute("data-shape");
  if (second === first) throw new Error("the next shape is the same");
  await card.getByTestId("chord-card-position").getByText(/^2 of /).waitFor();
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "detached" });
});

await step("a section sung again in another key: the card is the chord tapped, on its own pass", async () => {
  const modulating = await api(me, "POST", "/song-versions", {
    title: `Modulating ${stamp}`,
    language: "en",
    artists: ["Someone"],
    key: "G",
    content: "{start_of_chorus}\n[G]Glory [C]glory\n{end_of_chorus}\n{key: A}\n{start_of_chorus}\n[A]Glory [D]glory\n{end_of_chorus}\n",
    contentFormat: "CHORDPRO",
  });
  await page.goto(`${WEB}/library/${modulating.id}`);
  await page.waitForLoadState("networkidle");
  // One chorus, sung twice: its chords share their IDs on both passes.
  await page.getByRole("button", { name: "Show how to play C" }).click();
  if ((await page.getByTestId("chord-card").getAttribute("data-chord")) !== "C") throw new Error(await page.getByTestId("chord-card").getAttribute("data-chord"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show how to play D" }).click();
  if ((await page.getByTestId("chord-card").getAttribute("data-chord")) !== "D") throw new Error(await page.getByTestId("chord-card").getAttribute("data-chord"));
  await page.keyboard.press("Escape");
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
});

await step("the strip folds to one line, and stays folded", async () => {
  const strip = page.getByTestId("chord-strip");
  await strip.getByRole("button", { name: /Guitar chords/ }).click();
  await page.locator("[data-testid=chord-strip][data-folded]").waitFor();
  await strip.getByText("G · C · D · Em").waitFor();
  await page.reload();
  await page.locator("[data-testid=chord-strip][data-folded]").waitFor();
  await strip.getByRole("button", { name: /Guitar chords/ }).click();
  await page.locator("[data-testid=chord-strip]:not([data-folded])").waitFor();
});

await step("a set's song: switched to ukulele from the Display panel; Hide chords still hides", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("chord-strip").waitFor();
  await displaySetting(page, "instrument", "display-diagrams-UKULELE");
  await page.locator("[data-testid=chord-strip][data-instrument=ukulele]").waitFor();
  // A ukulele has no capo here: the chords as they sound.
  const chords = await page.getByTestId("chord-strip").locator("[data-chord-diagram]").evaluateAll((els) => els.map((el) => el.dataset.chordDiagram));
  if (chords.join() !== "A,D,E,F#m") throw new Error(chords.join());
  const a = await page.locator('[data-chord-diagram="A"] svg').getAttribute("data-shape");
  if (a !== "2100") throw new Error(`ukulele A drawn as ${a}`);
  await page.getByRole("button", { name: "Hide chords" }).click();
  await page.getByRole("button", { name: "Hide D for me" }).first().click();
  await page.getByText("Show 1 hidden chord").waitFor();
  if ((await page.getByTestId("chord-card").count()) > 0) throw new Error("a card while hiding chords");
  await page.getByText("Show 1 hidden chord").click();
  // Practice back to the account's diagrams (issue #209), for the steps below.
  await resetDisplay(page);
});

await step("Live: the strip at the top of the song", async () => {
  await page.goto(`${WEB}/sets/${set.id}/live/${item.id}`);
  await page.getByTestId("live-view").waitFor();
  // Each mode keeps its own (issue #209): ukulele for Live too.
  await displaySetting(page, "instrument", "display-diagrams-UKULELE");
  await page.locator("[data-testid=chord-strip][data-instrument=ukulele]").waitFor();
  await page.getByRole("button", { name: "Show how to play E" }).first().click();
  await page.getByTestId("chord-card").waitFor();
  await page.keyboard.press("Escape");
  await resetDisplay(page);
});

await step("your own shape for a chord, for this song only (issue #207 phase 3)", async () => {
  await api(me, "PATCH", "/users/me", { chordDiagrams: "GUITAR" });
  const other = await api(me, "POST", "/song-versions", {
    title: `Other G ${stamp}`,
    language: "en",
    artists: ["Someone"],
    key: "G",
    content: "{start_of_verse}\n[G]Other [C]song\n{end_of_verse}\n",
    contentFormat: "CHORDPRO",
  });
  const plain = await api(me, "POST", "/song-versions", { title: `Plain G ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: "{start_of_verse}\n[G]Third [C]song\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
  await page.goto(`${WEB}/library/${other.id}`);
  await page.waitForLoadState("networkidle");
  const strip = page.getByTestId("chord-strip");
  const usual = await strip.locator('[data-chord-diagram="G"] svg').getAttribute("data-shape");
  await page.getByRole("button", { name: "Show how to play G" }).click();
  const card = page.getByTestId("chord-card");
  await card.getByRole("button", { name: "Next shape" }).click();
  const second = await card.locator("svg[data-shape]").getAttribute("data-shape");
  await card.getByRole("button", { name: "Use this shape for this song" }).click();
  await card.getByTestId("chord-card-chosen").waitFor();
  await page.keyboard.press("Escape");
  // Kept for the song, on the account: the strip draws it, here and after reloading.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator(`[data-testid=chord-strip] [data-chord-diagram="G"] svg[data-shape="${second}"]`).waitFor();
  const saved = await api(me, "GET", `/song-versions/${other.id}/chord-shapes`);
  if (saved.length !== 1 || saved[0].chord !== "G" || saved[0].frets !== second) throw new Error(JSON.stringify(saved));
  // Another song's G is still the usual one.
  await page.goto(`${WEB}/library/${plain.id}`);
  await page.locator(`[data-testid=chord-strip] [data-chord-diagram="G"] svg[data-shape="${usual}"]`).waitFor();
  // Back to the usual one.
  await page.goto(`${WEB}/library/${other.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Show how to play G" }).click();
  await card.getByRole("button", { name: "Back to the usual one" }).click();
  await card.getByRole("button", { name: "Use this shape for this song" }).waitFor();
  if ((await api(me, "GET", `/song-versions/${other.id}/chord-shapes`)).length !== 0) throw new Error("not forgotten");
  await page.keyboard.press("Escape");
});

await step("a tuning, and left-handed diagrams", async () => {
  check("only tunings it knows", (await call(me, "PATCH", "/users/me", { guitarTuning: "banjo" })).status === 400);
  await page.goto(`${WEB}/dashboard`);
  await page.getByLabel("Guitar tuning").selectOption("drop-d");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Left-handed diagrams").selectOption("YES");
  await page.waitForLoadState("networkidle");
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  // C fretted (D sounding, capo 2) in drop D: its low string is a D, not an E.
  const strip = page.getByTestId("chord-strip");
  await strip.locator('[data-chord-diagram="C"] svg[data-left-handed]').waitFor();
  const me2 = await api(me, "GET", "/users/me");
  if (me2.guitarTuning !== "drop-d" || me2.leftHanded !== true) throw new Error(JSON.stringify(me2));
  await api(me, "PATCH", "/users/me", { guitarTuning: "standard", leftHanded: false });
});

await step("piano (phase 4): smooth voicings or root position, both hands or the right only, note names in the card", async () => {
  await chooseDiagrams("PIANO");
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  const strip = page.locator("[data-testid=chord-strip][data-instrument=piano]");
  await strip.waitFor();
  // As they sound (no capo for a piano): A D E F#m. Smooth: D's right hand stays near A's (A4 D5 F#5), the bass D3 in the left.
  const keys = (chord) => strip.locator(`[data-chord-diagram="${chord}"] svg`).getAttribute("data-keys");
  if ((await keys("A")) !== "57.69.73.76") throw new Error(`A ${await keys("A")}`);
  if ((await keys("D")) !== "50.69.74.78") throw new Error(`D ${await keys("D")}`);
  // The card: note names under the keys, and the voicing kept for the song.
  await page.getByRole("button", { name: "Show how to play D" }).first().click();
  const card = page.getByTestId("chord-card");
  await card.getByText("F#", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Next shape" }).click();
  await card.getByRole("button", { name: "Use this voicing for this song" }).click();
  await card.getByTestId("chord-card-chosen").waitFor();
  await page.keyboard.press("Escape");
  const chosen = (await api(me, "GET", `/song-versions/${song.id}/chord-shapes`)).find((one) => one.instrument === "piano");
  if (!chosen || chosen.chord !== "D") throw new Error(JSON.stringify(chosen));
  await api(me, "PUT", `/song-versions/${song.id}/chord-shapes`, { instrument: "piano", tuning: "standard", chord: "D", frets: null });
  // Root position, right hand only.
  await page.goto(`${WEB}/dashboard`);
  await page.getByLabel("Piano voicings").selectOption("ROOT");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Hands").selectOption("right");
  await page.waitForLoadState("networkidle");
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await strip.waitFor();
  if ((await keys("D")) !== "62.66.69") throw new Error(`D ${await keys("D")}`);
  await api(me, "PATCH", "/users/me", { pianoSmooth: true, pianoHands: "both", chordDiagrams: "OFF" });
});

await browser.close();
finish();
