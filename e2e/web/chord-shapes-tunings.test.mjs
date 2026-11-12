// Tunings, chord shapes and inversions (issues #355 and #228). In the song
// editor, a chord's bass notes are a tap away: its inversions, then the key's
// other notes. On a chord's card every shape shows at once, small: one tap
// keeps it for this song. A player can type their own tuning; an arrangement
// can set one, which shows on the chord strip with a link to the tuner.
import { chromium } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Shapes and tunings");
const song = await api(me, "POST", "/song-versions", {
  title: `Shapes ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  content: "{start_of_verse}\n[G]Amazing grace how [C]sweet the [D]sound\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});

const browser = await chromium.launch();
const errors = [];
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);
const same = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} (wanted ${JSON.stringify(b)})`);
};

await step("editor: a chord's bass notes, its inversions then the key's notes; one tap puts C/E in", async () => {
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  const editor = page.getByTestId("structured-editor");
  await editor.waitFor();
  await editor.locator('[data-sv-chord="C"] .sv-chord-chip').click();
  const bass = page.getByTestId("chord-popover").getByTestId("chord-bass");
  await bass.waitFor();
  const options = await bass.locator("[data-option]").evaluateAll((els) => els.map((el) => el.dataset.option));
  same(options, ["C", "C/E", "C/G", "C/D", "C/F#", "C/A", "C/B"], "bass notes of C in G");
  if (!(await bass.locator('[data-option="C/E"]').innerText()).includes("1st inv.")) throw new Error("no 1st inversion label");
  await page.screenshot({ path: `${SP}/chord-bass.png` });
  await bass.locator('[data-option="C/E"]').click();
  await page.waitForTimeout(200);
  same(await editor.locator(".sv-chord").evaluateAll((els) => els.map((el) => el.dataset.svChord)), ["G", "C/E", "D"], "chords");
});

await step("a chord's card shows every shape; one tap keeps it for this song", async () => {
  await api(me, "PATCH", "/users/me", { chordDiagrams: "GUITAR" });
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByTestId("chord-strip").waitFor();
  await page.getByRole("button", { name: "Show how to play D" }).first().click();
  const shapes = page.getByTestId("chord-card").getByTestId("chord-card-shapes");
  await shapes.waitFor();
  const all = await shapes.locator("button[data-shape]").evaluateAll((els) => els.map((el) => el.dataset.shape));
  if (all.length < 2 || all[0] !== "xx0232") throw new Error(JSON.stringify(all));
  await page.screenshot({ path: `${SP}/chord-card-shapes.png` });
  await shapes.locator("button[data-shape]").nth(1).click();
  await shapes.locator(`button[data-shape="${all[1]}"][data-chosen]`).waitFor();
  const chosen = (await api(me, "GET", `/song-versions/${song.id}/chord-shapes`)).find((one) => one.instrument === "guitar" && one.chord === "D");
  if (chosen?.frets !== all[1]) throw new Error(JSON.stringify(chosen));
  // The strip draws it that way too.
  await page.keyboard.press("Escape");
  same(await page.getByTestId("chord-strip").locator('[data-chord-diagram="D"] svg').getAttribute("data-shape"), all[1], "D on the strip");
});

await step("a tuning of one's own, typed as its strings", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("account-tuning").selectOption("__own__");
  await page.getByTestId("account-tuning-own").fill("C G D G B D");
  await page.getByTestId("account-tuning-own-save").click();
  for (let i = 0; ; i++) {
    const tuning = (await api(me, "GET", "/users/me")).guitarTuning;
    if (tuning === "custom:C2-G2-D3-G3-B3-D4") break;
    if (i === 20) throw new Error(tuning);
    await page.waitForTimeout(200);
  }
  await page.reload();
  await page.waitForLoadState("networkidle");
  same(await page.getByTestId("account-tuning").inputValue(), "custom:C2-G2-D3-G3-B3-D4", "the picker after a reload");
  await page.getByTestId("account-tuning").locator("option:checked").getByText("CGDGBD").waitFor({ state: "attached" });
  await api(me, "PATCH", "/users/me", { guitarTuning: "standard" });
});

await step("an arrangement in open G: the strip says so, Tune opens the tuner set to it", async () => {
  const arrangement = await api(me, "POST", `/song-versions/${song.id}/arrangements`, { name: "Open G" });
  await page.goto(`${WEB}/library/${song.id}/arrangements/${arrangement.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("arrangement-tuning").selectOption("open-g");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForLoadState("networkidle");
  for (let i = 0; ; i++) {
    const saved = await api(me, "GET", `/arrangements/${arrangement.id}`);
    if (saved.document?.defaults?.guitarTuning === "open-g") break;
    if (i === 20) throw new Error(JSON.stringify(saved.document?.defaults));
    await page.waitForTimeout(200);
  }
  const set = await api(me, "POST", "/setlists", { name: `Open G set ${stamp}` });
  const item = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items[0];
  await api(me, "PATCH", `/setlists/${set.id}/items/${item.id}`, { arrangementId: arrangement.id });
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  const badge = page.getByTestId("chord-strip-tuning");
  await badge.waitFor();
  same(await badge.getAttribute("data-tuning"), "open-g", "the strip's tuning");
  // G in open G: the open strings.
  const g = await page.getByTestId("chord-strip").locator('[data-chord-diagram="G"] svg').getAttribute("data-shape");
  if (!/^[x0]{6}$/.test(g)) throw new Error(`G in open G: ${g}`);
  await page.screenshot({ path: `${SP}/chord-strip-tuning.png` });
  await page.getByTestId("chord-strip-tune").click();
  await page.waitForURL("**/tuner**");
  await page.getByTestId("tuner-tuning").getByText("Open G").waitFor();
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await api(me, "PATCH", "/users/me", { chordDiagrams: "OFF" });
await browser.close();
finish();
