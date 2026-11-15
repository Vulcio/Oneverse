// Drum grooves (issue #105): the editor's Drum groove panel gives the song a style and each section a variation
// (Light, Simple, Full, Half-time or none) and a fill on its last bar, each heard on its own first; saved in the
// sections. The metronome then plays the drums where a section has a groove, on its own clock (the same timeline as the
// click, which stops there unless Display says to click with it), and the Drums view shows the bar's pattern as a grid
// or as one line, the beat being played lit. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Grooves");
const CHART = "{start_of_verse}\n[G]Amazing grace how [C]sweet the sound\n[G]That saved a wretch like [D]me\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n";
const song = await api(me, "POST", "/song-versions", { title: `Grooves ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 120, timeSignature: "4/4", content: CHART, contentFormat: "CHORDPRO" });
const stored = async () => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;
const waltz = await api(me, "POST", "/song-versions", { title: `Grooves waltz ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 120, timeSignature: "5/4", content: CHART, contentFormat: "CHORDPRO" });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  const dialog = () => page.getByTestId("groove-dialog");
  const row = (n) => dialog().getByTestId("groove-row").nth(n);

  await step("Editor: Drum groove gives the song a style, each section a variation and a fill", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await page.getByTestId("structured-editor").waitFor();
    await page.waitForLoadState("networkidle");
    if ((await page.getByTestId("editor-groove").getAttribute("aria-pressed")) === "true") throw new Error("pressed without a groove");
    await page.getByTestId("editor-groove").click();
    await dialog().waitFor();
    const styles = await dialog().getByTestId("groove-style").locator("option").allInnerTexts();
    if (!styles.includes("Pop-Rock") || !styles.includes("Worship") || styles.includes("6/8 Ballad")) throw new Error(`styles: ${styles}`);
    await dialog().getByTestId("groove-style").selectOption("pop-rock");
    await row(0).waitFor();
    if ((await dialog().getByTestId("groove-row").count()) !== 2) throw new Error("not a row per section");
    // A verse plays Simple, a chorus Full, both with a fill.
    if ((await row(0).getByTestId("groove-variant-simple").getAttribute("aria-checked")) !== "true") throw new Error("the verse isn't Simple");
    if ((await row(1).getByTestId("groove-variant-full").getAttribute("aria-checked")) !== "true") throw new Error("the chorus isn't Full");
    if (!(await row(0).getByTestId("groove-fill").isChecked())) throw new Error("no fill on the verse");
    await row(1).getByTestId("groove-variant-halfTime").click();
    await row(1).getByTestId("groove-fill").uncheck();
    // Heard on its own: pressed while it plays, again stops it.
    await row(1).getByTestId("groove-listen").click();
    if ((await row(1).getByTestId("groove-listen").getAttribute("aria-pressed")) !== "true") throw new Error("the preview doesn't play");
    await row(1).getByTestId("groove-listen").click();
    if ((await row(1).getByTestId("groove-listen").getAttribute("aria-pressed")) !== "false") throw new Error("the preview doesn't stop");
    await page.screenshot({ path: `${SP}/grooves-editor.png` });
    await dialog().getByTestId("groove-done").click();
    await dialog().waitFor({ state: "hidden" });
    const tags = await page.getByTestId("section-groove").allInnerTexts();
    if (tags.length !== 2 || !/Simple/.test(tags[0]) || !/Fill/.test(tags[0]) || !/Half-time/.test(tags[1]) || /Fill/.test(tags[1])) throw new Error(`tags: ${tags}`);
    if ((await page.getByTestId("editor-groove").getAttribute("aria-pressed")) !== "true") throw new Error("not pressed with a groove");
    await page.getByRole("button", { name: "Save song" }).first().click();
    await page.getByText("Saved.", { exact: true }).waitFor();
    const grooves = (await stored()).sections.map((section) => section.groove);
    if (grooves[0]?.styleId !== "pop-rock" || grooves[0]?.variant !== "simple" || grooves[0]?.fill !== true) throw new Error(JSON.stringify(grooves));
    if (grooves[1]?.variant !== "halfTime" || grooves[1]?.fill !== false) throw new Error(JSON.stringify(grooves));
  });

  await step("the tag opens the panel; No groove clears every section", async () => {
    await page.getByTestId("section-groove").first().click();
    await dialog().waitFor();
    await dialog().getByTestId("groove-style").selectOption("");
    if (await dialog().getByTestId("groove-row").count()) throw new Error("rows without a style");
    await dialog().getByTestId("groove-done").click();
    if (await page.getByTestId("section-groove").count()) throw new Error("tags left");
    // Back as it was saved, for the next steps.
    await page.reload();
    await page.getByTestId("structured-editor").waitFor();
    if ((await page.getByTestId("section-groove").count()) !== 2) throw new Error("the saved grooves don't come back");
  });

  await step("a time signature without a built-in groove says so", async () => {
    await page.goto(`${WEB}/library/${waltz.id}?tab=editor`);
    await page.getByTestId("structured-editor").waitFor();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("editor-groove").click();
    await dialog().getByTestId("groove-none").waitFor();
    await page.keyboard.press("Escape");
  });

  const drums = () => page.evaluate(() => window.songverseMetronome?.drums ?? []);
  const clicks = () => page.evaluate(() => window.songverseMetronome?.clicks ?? []);

  await step("Live: the metronome plays the drums, the click only in the count-in", async () => {
    await page.goto(`${WEB}/library/${song.id}/live`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("metronome-song").click();
    await page.waitForFunction(() => (window.songverseMetronome?.drums ?? []).length > 8, null, { timeout: 8000 });
    const hits = await drums();
    const first = Math.min(...hits.map((hit) => hit.time));
    const kinds = new Set(hits.map((hit) => hit.drum));
    if (!kinds.has("kick") || !kinds.has("snare") || !kinds.has("hihat")) throw new Error(`drums: ${[...kinds]}`);
    // The song's first hit is a kick on bar 0, on the beat after the count-in's last click.
    const opening = hits.filter((hit) => hit.time === first).map((hit) => hit.drum);
    if (!opening.includes("kick") || hits.find((hit) => hit.time === first).bar !== 0) throw new Error(`opening: ${opening}`);
    const after = (await clicks()).filter((click) => click.time >= first - 0.005);
    if (after.length) throw new Error(`${after.length} clicks with the drums`);
    // At 120, the snare's backbeat half a bar apart.
    const snares = hits.filter((hit) => hit.drum === "snare" && hit.bar === 0).map((hit) => hit.time - first);
    if (Math.abs(snares[0] - 0.5) > 0.002 || Math.abs(snares[1] - 1.5) > 0.002) throw new Error(`snares at ${snares}`);
  });

  await step("Display: click with the drums, the groove as a grid or one line in the Drums view", async () => {
    await page.getByTestId("chart-view-drums").click();
    const grid = page.getByTestId("drums-groove");
    await grid.waitFor();
    if (!/Pop-Rock · Simple/.test(await grid.getByTestId("drums-groove-name").innerText())) throw new Error(await grid.innerText());
    if ((await grid.getAttribute("data-look")) !== "grid") throw new Error("not a grid");
    await page.waitForFunction(() => document.querySelector('[data-testid="drums-groove"] [data-lit]'), null, { timeout: 5000 });
    await page.screenshot({ path: `${SP}/grooves-drums-view.png` });
    await page.getByTestId("display-open").first().click();
    await page.getByTestId("display-grooveClick-on").click();
    const since = await page.evaluate(() => window.songverseMetronome.now());
    await page.waitForFunction((from) => window.songverseMetronome.clicks.some((click) => click.time > from + 0.2), since, { timeout: 5000 });
    await page.getByTestId("display-grooveLook-line").click();
    if ((await grid.getAttribute("data-look")) !== "line") throw new Error("not one line");
    if ((await grid.locator("[data-lit]").count()) % 3 !== 0) throw new Error("the line isn't three rows");
    await page.getByTestId("display-groovePlay-off").click();
    const quiet = await page.evaluate(() => window.songverseMetronome.now());
    await page.waitForTimeout(800);
    const later = (await drums()).filter((hit) => hit.time > quiet + 0.6);
    if (later.length) throw new Error(`${later.length} hits after turning grooves off`);
    // Back as they were, for the other suites on this device.
    await page.getByTestId("display-groovePlay-on").click();
    await page.getByTestId("display-grooveClick-off").click();
    await page.getByTestId("display-grooveLook-grid").click();
    await page.getByRole("button", { name: "Stop the metronome" }).click();
  });
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
}
finish();
