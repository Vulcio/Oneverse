// The song editor's Bars (issue #465): the chord grid's Edit bars in Edit mode, beside Visual, Text and Preview.
// A chord tapped then put on a beat changes the sections there and then; the chart's bar lines follow; the editor's
// Save song saves it as the section's rhythm. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Editor grid");
const CHART = "{start_of_verse}\n[G]Amazing [C]grace how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\n{end_of_verse}\n";
const song = await api(me, "POST", "/song-versions", { title: `Editor grid ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 120, timeSignature: "4/4", content: CHART, contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  const grid = () => page.getByTestId("editor-bars");
  const bar = (index) => grid().locator(`[data-grid-bar="${index}"]`);
  const chordsOf = async (index) => (await bar(index).locator("[data-grid-chord]").allInnerTexts()).join(" ");

  await step("Edit mode's Bars: the grid, already editing, without a Save of its own", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await page.getByTestId("structured-editor").waitFor();
    await page.getByRole("radio", { name: "Bars", exact: true }).click();
    await page.getByTestId("chord-grid-edit").waitFor();
    if (await grid().getByTestId("chord-grid-save").count()) throw new Error("the grid has its own Save");
    if ((await chordsOf(0)) !== "G C" || (await chordsOf(1)) !== "G D") throw new Error(`${await chordsOf(0)} / ${await chordsOf(1)}`);
  });

  await step("C tapped, then beat 2 of its bar: moved there, the song changed", async () => {
    await bar(0).locator('[data-grid-chord="C"]').click();
    await bar(0).locator('[data-grid-slot][data-beat="2"]').click();
    if ((await bar(0).locator('[data-grid-chord="C"]').getAttribute("data-beat-at")) !== "2") throw new Error("C not on beat 2");
    await page.getByRole("button", { name: "Save song" }).first().waitFor({ state: "visible" });
    if (await page.getByRole("button", { name: "Save song" }).first().isDisabled()) throw new Error("the song isn't changed");
    await page.screenshot({ path: `${SP}/editor-grid.png` });
  });

  await step("back in Visual and saved: the section's rhythm has C on beat 2 of bar 1", async () => {
    await page.getByRole("radio", { name: "Visual", exact: true }).click();
    await page.getByTestId("structured-editor").waitFor();
    await page.getByRole("button", { name: "Save song" }).first().click();
    await page.getByText("Saved.", { exact: true }).waitFor();
    const saved = await api(me, "GET", `/song-versions/${song.id}`);
    const section = saved.documentJson.sections[0];
    const raw = new Map(section.lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord.raw])));
    const first = section.rhythm.bars[0].chords.map((chord) => `${raw.get(chord.chordId)}@${chord.beat}`).join(" ");
    if (first !== "G@1 C@2") throw new Error(`bar 1: ${first}`);
  });

  await step("Bars again after the save: as saved", async () => {
    await page.getByRole("radio", { name: "Bars", exact: true }).click();
    await page.getByTestId("chord-grid-edit").waitFor();
    if ((await chordsOf(0)) !== "G C") throw new Error(`bar 1: ${await chordsOf(0)}`);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
