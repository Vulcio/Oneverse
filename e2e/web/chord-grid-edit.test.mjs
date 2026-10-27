// The chord grid, edited and played (issue #238): Edit bars places a chord on a beat - tapped there, or dragged, the
// right half of a beat being its "and" - refuses one that would pass its neighbour, and gives a bar its own length,
// adds and removes bars; saved as the section's rhythm, which the grid reads again after a reload. Play plays the
// click from the top, a tap on a bar from that bar; with a recording, Loop goes over the bars chosen. Screenshots go
// to e2e/.artifacts.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API, SP, WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Grid editor");
const content =
  "{start_of_verse}\n[G]Amazing [C]grace how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\nI once was lost\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n";
const song = await api(me, "POST", "/song-versions", { title: `Grid edit ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 150, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const grid = () => page.getByTestId("chord-grid");
  const bar = (index) => grid().locator(`[data-grid-bar="${index}"]`);
  const slot = (index, beat) => bar(index).locator(`[data-grid-slot][data-beat="${beat}"]`);
  const chordsOf = async (index) => (await bar(index).locator("[data-grid-chord]").allInnerTexts()).join(" ");
  const position = async () => ((await grid().getAttribute("data-position")) ?? "").split(":").map(Number);

  await step("Practice's grid: Edit bars for whoever can edit the song", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("chart-view-grid").click();
    await grid().waitFor();
    // As filled in from the chart: the verse's 4 + 3 chords and a line without (2 bars), the chorus's 2.
    if ((await grid().locator("[data-grid-bar]").count()) !== 11) throw new Error(`${await grid().locator("[data-grid-bar]").count()} bars`);
    await page.getByTestId("chord-grid-edit-start").click();
    await page.getByTestId("chord-grid-edit").waitFor();
    // Two places a beat: on it and its "and".
    if ((await bar(0).locator("[data-grid-slot]").count()) !== 8) throw new Error("not two places a beat");
  });

  await step("a chord tapped, then a beat: C on beat 3 of bar 1, with G", async () => {
    await bar(1).locator('[data-grid-chord="C"]').click();
    await slot(0, 3).click();
    if ((await chordsOf(0)) !== "G C") throw new Error(`bar 1: ${await chordsOf(0)}`);
    if ((await chordsOf(1)) !== "") throw new Error(`bar 2: ${await chordsOf(1)}`);
    if ((await bar(0).locator('[data-grid-chord="C"]').getAttribute("data-beat-at")) !== "3") throw new Error("C not on beat 3");
  });

  await step("a chord dragged onto the and of 2: D in bar 4", async () => {
    const from = await bar(3).locator('[data-grid-chord="D"]').boundingBox();
    const to = await slot(3, 2.5).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    if ((await bar(3).locator('[data-grid-chord="D"]').getAttribute("data-beat-at")) !== "2.5") throw new Error("D not on the and of 2");
  });

  await step("a chord can't pass the one before it: refused, said why", async () => {
    // The third chord (G, bar 3) before C, now on beat 3 of bar 1.
    await bar(2).locator('[data-grid-chord="G"]').click();
    await slot(0, 2).click();
    await page.getByTestId("chord-grid-problem").waitFor();
    if ((await chordsOf(2)) !== "G") throw new Error(`bar 3: ${await chordsOf(2)}`);
  });

  await step("a bar's tools: the empty bar 8 made 2 beats, a bar added after it and removed", async () => {
    await bar(7).locator("[data-grid-words]").click();
    const tools = page.getByTestId("chord-grid-bar-tools");
    await tools.waitFor();
    await tools.getByTestId("chord-grid-shorter").click();
    await tools.getByTestId("chord-grid-shorter").click();
    if ((await bar(7).locator("[data-grid-beat]").count()) !== 2) throw new Error(`${await bar(7).locator("[data-grid-beat]").count()} beats`);
    await tools.getByTestId("chord-grid-add-after").click();
    if ((await grid().locator("[data-grid-bar]").count()) !== 12) throw new Error("no bar added");
    // The new bar is picked: removed again.
    await tools.getByTestId("chord-grid-remove").click();
    if ((await grid().locator("[data-grid-bar]").count()) !== 11) throw new Error("not removed");
    // A bar with chords can't be removed until they're moved.
    await bar(0).locator("[data-grid-words]").click();
    if (!(await tools.getByTestId("chord-grid-remove").isDisabled())) throw new Error("a bar with chords can be removed");
    await page.screenshot({ path: `${SP}/chord-grid-edit.png` });
  });

  await step("saved as the verse's rhythm, and the grid reads it after a reload", async () => {
    await page.getByTestId("chord-grid-save").click();
    await page.getByTestId("chord-grid-edit").waitFor({ state: "detached" });
    const saved = await api(me, "GET", `/song-versions/${song.id}`);
    const rhythm = saved.documentJson.sections[0].rhythm;
    const chordIds = new Map(saved.documentJson.sections[0].lines.flatMap((line) => line.chords.map((chord) => [chord.id, chord.raw])));
    const first = rhythm.bars[0].chords.map((chord) => `${chordIds.get(chord.chordId)}@${chord.beat}`).join(" ");
    if (first !== "G@1 C@3") throw new Error(`bar 1: ${first}`);
    if (rhythm.bars[3].chords.map((chord) => `${chordIds.get(chord.chordId)}@${chord.beat}`).join(" ") !== "D@2.5") throw new Error(JSON.stringify(rhythm.bars[3]));
    if (rhythm.bars[7].beats !== 2) throw new Error(JSON.stringify(rhythm.bars[7]));
    if (rhythm.bars.length !== 9) throw new Error(`${rhythm.bars.length} bars`);
    await page.reload();
    await grid().waitFor();
    if ((await chordsOf(0)) !== "G C") throw new Error(`bar 1 after reload: ${await chordsOf(0)}`);
    if ((await bar(7).locator("[data-grid-beat]").count()) !== 2) throw new Error("bar 8 not 2 beats after reload");
    // The words still under their bars.
    if ((await bar(0).locator("[data-grid-words]").innerText()).trim() !== "Amazing grace how") throw new Error(await bar(0).locator("[data-grid-words]").innerText());
  });

  await step("Play: the click from the top; a tap on bar 5 plays from there", async () => {
    await page.getByTestId("chord-grid-play").click();
    await page.locator('[data-testid="chord-grid"][data-source="click"]').waitFor();
    await page.waitForTimeout(500);
    const [start] = await position();
    if (!(start <= 1)) throw new Error(`at bar ${start} just after Play`);
    await bar(4).click();
    await page.waitForTimeout(500);
    const [from, beat] = await position();
    if (from !== 4) throw new Error(`at ${from}:${beat} after a tap on bar 5`);
    await page.getByTestId("chord-grid-play").click();
    await page.locator('[data-testid="chord-grid"][data-source]').waitFor({ state: "detached" });
  });

  await step("with a recording: Loop goes over the bars chosen", async () => {
    // A recording whose beats come every quarter second (240 BPM), bars of four.
    const form = new FormData();
    form.append("type", "AUDIO");
    form.append("file", new Blob([readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems/Morning Light - Bass.mp3"))], { type: "audio/mpeg" }), "Beats.mp3");
    const uploaded = await (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form })).json();
    const beats = Array.from({ length: 400 }, (_, i) => (i * 0.25).toFixed(3));
    const downbeats = beats.filter((_, i) => i % 4 === 0);
    sql(`update "Attachment" set "recordingBeats" = '{${beats.join(",")}}', "recordingDownbeats" = '{${downbeats.join(",")}}' where id = '${uploaded.id}'`);
    await page.reload();
    await grid().waitFor();
    await page.getByTestId("chord-grid-loop").waitFor({ timeout: 20000 });
    await page.getByTestId("chord-grid-loop").click();
    await page.getByTestId("chord-grid-loop-hint").waitFor();
    await bar(2).click();
    await bar(3).click();
    await page.locator('[data-testid="chord-grid"][data-source="stems"]').waitFor({ timeout: 15000 });
    if ((await grid().locator("[data-grid-bar][data-looped]").count()) !== 2) throw new Error(`${await grid().locator("[data-grid-bar][data-looped]").count()} bars looped`);
    // Two bars of four quarter seconds: two seconds a time round; after three, still in them.
    await page.waitForTimeout(3000);
    const [at] = await position();
    if (at !== 2 && at !== 3) throw new Error(`at bar ${at + 1} while looping bars 3-4`);
    await page.getByTestId("chord-grid-loop").click();
    if ((await grid().locator("[data-grid-bar][data-looped]").count()) !== 0) throw new Error("still looping");
    await page.getByTestId("chord-grid-play").click();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
