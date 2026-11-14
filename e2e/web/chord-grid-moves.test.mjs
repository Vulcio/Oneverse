// Edit bars moving chords as a video editor moves clips (issue #462): In place by default (only the chords up to
// the next key chord move, spread evenly), Ripple (everything after moves, bars added at the end), key chords pinned
// and unpinned, the picked chord's floating toolbar and the arrow keys, a section's number of bars, and the sections
// with the same chords: the same words changed with it, other words offered, with a dashed preview, then linked.
// Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { SP, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Grid mover");
const content = [
  "{start_of_verse: Verse 1}",
  "[C]When peace like a [F]river at[C]tendeth my way",
  "[Am]When sorrows like [G]sea billows roll",
  "{end_of_verse}",
  "{start_of_chorus}",
  "[F]It is well [C]with my soul",
  "{end_of_chorus}",
  "{start_of_verse: Verse 2}",
  "[C]Though Satan should [F]buffet though [C]trials should come",
  "[Am]Let this blest as[G]surance control",
  "{end_of_verse}",
  "",
].join("\n");
const song = await api(me, "POST", "/song-versions", { title: `Grid moves ${stamp}`, language: "en", artists: ["Spafford"], key: "C", tempo: 72, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const grid = () => page.getByTestId("chord-grid");
  const pass = (index) => grid().getByTestId("chord-grid-pass").nth(index);
  const bar = (passIndex, index) => pass(passIndex).locator("[data-grid-bar]").nth(index);
  const slot = (passIndex, index, beat) => bar(passIndex, index).locator(`[data-grid-slot][data-beat="${beat}"]`);
  // Each bar's chords with their beats, "*" for a key chord: "C@1* F@3*".
  const barsOf = async (passIndex) =>
    pass(passIndex)
      .locator("[data-grid-bar]")
      .evaluateAll((bars) => bars.map((one) => [...one.querySelectorAll("[data-grid-chord]")].map((chord) => `${chord.dataset.gridChord}@${chord.dataset.beatAt}${chord.hasAttribute("data-key-chord") ? "*" : ""}`).join(" ")));
  const expectBars = async (passIndex, expected) => {
    const got = await barsOf(passIndex);
    if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`pass ${passIndex + 1}: ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
  };
  const drag = async (from, to) => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    return () => page.mouse.up();
  };

  await step("Edit bars: In place by default, the chords on beat 1 are key chords", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("chart-view-grid").click();
    await grid().waitFor();
    await page.getByTestId("display-open").first().click();
    await page.getByTestId("chord-grid-edit-start").click();
    if (await page.getByTestId("display-panel").isVisible()) await page.getByTestId("display-close").click();
    await page.getByTestId("chord-grid-edit").waitFor();
    if ((await page.getByTestId("chord-grid-mode-inPlace").getAttribute("aria-pressed")) !== "true") throw new Error("In place isn't the default");
    await expectBars(0, ["C@1*", "F@1*", "C@1*", "Am@1*", "G@1*"]);
    if ((await pass(0).getByTestId("chord-grid-bars-count").innerText()) !== "5 bars") throw new Error(await pass(0).getByTestId("chord-grid-bars-count").innerText());
  });

  await step("a chord picked: its floating toolbar unpins it", async () => {
    await bar(0, 2).locator('[data-grid-chord="C"]').click();
    const tools = page.getByTestId("chord-tools");
    await tools.waitFor();
    await tools.getByTestId("chord-tools-pin").click();
    await expectBars(0, ["C@1*", "F@1*", "C@1", "Am@1*", "G@1*"]);
    await tools.getByTestId("chord-tools-done").click();
    await tools.waitFor({ state: "detached" });
  });

  await step("F dragged to beat 3 of bar 1: a preview while dragging, the C after it spread evenly up to Am", async () => {
    const drop = await drag(bar(0, 1).locator('[data-grid-chord="F"]'), slot(0, 0, 3));
    await page.locator('[data-testid="chord-grid-status"]').filter({ hasText: "In place: 1 chord moves to make room." }).waitFor();
    if ((await grid().locator("[data-grid-chord][data-moving]").count()) < 1) throw new Error("the C moving isn't shown");
    await page.screenshot({ path: `${SP}/chord-grid-moves-drag.png` });
    await drop();
    await expectBars(0, ["C@1* F@3*", "C@4", "", "Am@1*", "G@1*"]);
  });

  await step("Verse 2, with the same chords, is offered the same bars, dashed; applied and linked", async () => {
    const offer = page.getByTestId("chord-grid-offer");
    await offer.waitFor();
    if (!(await offer.innerText()).includes("Verse 2")) throw new Error(await offer.innerText());
    await pass(2).getByTestId("chord-grid-preview").waitFor();
    await page.screenshot({ path: `${SP}/chord-grid-moves-offer.png` });
    await offer.getByTestId("chord-grid-offer-apply").click();
    await offer.waitFor({ state: "detached" });
    await expectBars(2, ["C@1* F@3*", "C@4", "", "Am@1*", "G@1*"]);
    await pass(0).getByTestId("chord-grid-linked").waitFor();
  });

  await step("Ripple and the arrow keys: Am a beat later, G with it, a bar added; Verse 2 too, linked", async () => {
    await page.getByTestId("chord-grid-mode-ripple").click();
    await bar(0, 3).locator('[data-grid-chord="Am"]').focus();
    await page.keyboard.press("ArrowRight");
    await expectBars(0, ["C@1* F@3*", "C@4", "", "Am@2*", "G@2*", ""]);
    await expectBars(2, ["C@1* F@3*", "C@4", "", "Am@2*", "G@2*", ""]);
    // The focus stays on the chord it moved: once more, with Shift, a whole bar.
    await page.keyboard.press("Shift+ArrowLeft");
    await expectBars(0, ["C@1* F@3*", "C@4", "Am@2*", "G@2*", ""]);
  });

  await step("a section's number of bars: the chorus given one more, the verses one fewer", async () => {
    await pass(1).getByTestId("chord-grid-more-bars").click();
    if ((await pass(1).getByTestId("chord-grid-bars-count").innerText()) !== "3 bars") throw new Error(await pass(1).getByTestId("chord-grid-bars-count").innerText());
    // Verse 1's empty last bar taken off (Verse 2's too, linked); then a bar with chords can't be: refused, said why.
    await pass(0).getByTestId("chord-grid-fewer-bars").click();
    await expectBars(0, ["C@1* F@3*", "C@4", "Am@2*", "G@2*"]);
    await expectBars(2, ["C@1* F@3*", "C@4", "Am@2*", "G@2*"]);
    await pass(0).getByTestId("chord-grid-fewer-bars").click();
    await page.getByTestId("chord-grid-problem").waitFor();
    await page.screenshot({ path: `${SP}/chord-grid-moves.png` });
  });

  await step("saved: both verses' bars and the chorus's, the moved chords pinned", async () => {
    await page.getByTestId("chord-grid-save").click();
    await page.getByTestId("chord-grid-edit").waitFor({ state: "detached" });
    const saved = await api(me, "GET", `/song-versions/${song.id}`);
    const bars = (section) => {
      const raw = new Map(section.lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord.raw])));
      return section.rhythm.bars.map((one) => one.chords.map((chord) => `${raw.get(chord.chordId)}@${chord.beat}${chord.pinned ? "!" : chord.pinned === false ? "~" : ""}`).join(" "));
    };
    const [verse1, chorus, verse2] = saved.documentJson.sections;
    const expected = ["C@1 F@3!", "C@4", "Am@2!", "G@2!"];
    if (JSON.stringify(bars(verse1)) !== JSON.stringify(expected)) throw new Error(`verse 1: ${JSON.stringify(bars(verse1))}`);
    if (JSON.stringify(bars(verse2)) !== JSON.stringify(expected)) throw new Error(`verse 2: ${JSON.stringify(bars(verse2))}`);
    if (chorus.rhythm.bars.length !== 3) throw new Error(`chorus: ${chorus.rhythm.bars.length} bars`);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
