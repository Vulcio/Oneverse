// The beats in the words, and the screens following the music (issue #238): the chord grid places each beat of a bar in
// its words by itself (a word held over a beat gets none), and lights the words of the beat played. In Edit bars, each
// beat is a number before its letter: tapped then a letter, or dragged onto one, it's placed there by hand - letter by
// letter, but only in its own bar's words - and "Let the grid place it" undoes that; beat 1 moves the bar line. Saved in
// the section's rhythm. The Editor shows the same beats under the words of a section with bar lines, to tap (then a
// letter) or drag; tapped twice, one placed by hand goes back to the grid's place. In Live, presenting, Follow the music moves the slides on with the click, and Next turns it off.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Beat placer");
const content = "{start_of_verse}\n[G]Amazing grace how [C]sweet the sound\n{end_of_verse}\n";
const song = await api(me, "POST", "/song-versions", { title: `Beats ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 120, timeSignature: "4/4", content, contentFormat: "CHORDPRO" });
// Four lines of a verse (two slides) and a chorus (one), quick: a slide every few seconds.
const followed = await api(me, "POST", "/song-versions", {
  title: `Followed ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  tempo: 240,
  timeSignature: "4/4",
  content: "{start_of_verse}\n[G]Amazing grace\n[C]how sweet the sound\n[G]that saved a wretch\n[D]like me\n{end_of_verse}\n{start_of_chorus}\n[C]I once was lost\n[G]but now am found\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
const set = await api(me, "POST", "/setlists", { name: `Followed ${stamp}` });
const { items } = await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: followed.id });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  const grid = () => page.getByTestId("chord-grid");
  const bar = (index) => grid().locator(`[data-grid-bar="${index}"]`);
  const tick = (index, beat) => bar(index).locator(`[data-beat-tick="${beat}"]`);
  const letter = (index, at) => bar(index).locator(`[data-letter][data-at="${at}"]`);
  // The letter a beat's number stands before.
  const tickAt = (index, beat) => tick(index, beat).evaluate((element) => element.parentElement?.querySelector("[data-letter]")?.dataset.at ?? null);
  const drag = async (from, to) => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };

  await step("the grid's words, cut at the beats placed in them", async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("chart-view-grid").click();
    await grid().waitFor();
    // "Amazing grace how" over 4 beats: Amazing, grace, how - and the 4th held over "how".
    const pieces = await bar(0).locator("[data-word-beat]").allInnerTexts();
    if (pieces.map((one) => one.trim()).join("|") !== "Amazing|grace|how") throw new Error(pieces.join("|"));
  });

  await step("Edit bars: a number a beat before its letter, a held beat after the one before", async () => {
    await page.getByTestId("chord-grid-edit-start").click();
    await page.getByTestId("chord-grid-edit").waitFor();
    if ((await bar(0).locator("[data-beat-tick]").count()) !== 4) throw new Error(`${await bar(0).locator("[data-beat-tick]").count()} beats`);
    if ((await tickAt(0, 2)) !== "8") throw new Error(`beat 2 at ${await tickAt(0, 2)}`);
    if ((await tickAt(0, 3)) !== "14") throw new Error(`beat 3 at ${await tickAt(0, 3)}`);
    // Beat 4, held: right after beat 3, before "how".
    if ((await tick(0, 3).evaluate((element) => element.nextElementSibling?.getAttribute("data-beat-tick"))) !== "4") throw new Error("beat 4 not after beat 3");
  });

  await step("beat 3 tapped, then the e of grace: placed there by hand", async () => {
    await tick(0, 3).click();
    await page.getByText("Now tap the letter beat 3 is sung on").waitFor();
    await letter(0, 12).click();
    if ((await tickAt(0, 3)) !== "12") throw new Error(`beat 3 at ${await tickAt(0, 3)}`);
    if ((await tick(0, 3).getAttribute("data-placed")) === null) throw new Error("not marked placed by hand");
  });

  await step("Let the grid place it: back on how; placed again by a drag", async () => {
    await tick(0, 3).click();
    await page.getByTestId("chord-grid-beat-auto").click();
    if ((await tickAt(0, 3)) !== "14") throw new Error(`beat 3 at ${await tickAt(0, 3)}`);
    await drag(tick(0, 3), letter(0, 12));
    if ((await tickAt(0, 3)) !== "12") throw new Error(`beat 3 dragged to ${await tickAt(0, 3)}`);
  });

  await step("a beat stays in its bar's words: dragged into the next bar, refused", async () => {
    await drag(tick(0, 2), letter(1, 25));
    await page.getByTestId("chord-grid-problem").getByText("A beat stays in its bar's words").waitFor();
    if ((await tickAt(0, 2)) !== "8") throw new Error(`beat 2 at ${await tickAt(0, 2)}`);
  });

  await step("beat 1 of bar 2 dragged onto how: the bar line moves", async () => {
    await drag(tick(1, 1), letter(0, 14));
    if ((await bar(1).locator("[data-letter]").first().getAttribute("data-at")) !== "14") throw new Error("bar 2 doesn't start at how");
    if ((await bar(0).locator("[data-letter]").last().getAttribute("data-at")) !== "12") throw new Error("bar 1 still has how");
  });

  await step("saved in the rhythm; the grid reads it after a reload", async () => {
    await page.getByTestId("chord-grid-save").click();
    await page.getByTestId("chord-grid-edit").waitFor({ state: "detached" });
    const saved = await api(me, "GET", `/song-versions/${song.id}`);
    const bars = saved.documentJson.sections[0].rhythm.bars;
    const line = saved.documentJson.sections[0].lines[0].id;
    const anchors = (bars[0].beatAnchors ?? []).map((anchor) => `${anchor.beat}@${anchor.lineId === line ? "" : anchor.lineId}${anchor.at}`);
    if (anchors.join(" ") !== "3@12") throw new Error(JSON.stringify(bars[0]));
    if (bars[1].lyricAnchor?.at !== 14) throw new Error(JSON.stringify(bars[1]));
    await page.reload();
    await grid().waitFor();
    if ((await bar(0).locator("[data-grid-words]").innerText()).trim() !== "Amazing grace") throw new Error(await bar(0).locator("[data-grid-words]").innerText());
    // Beat 3 on the e: "grac" sung on 2, "e" on 3.
    const pieces = await bar(0).locator("[data-word-beat]").allInnerTexts();
    if (pieces.join("|") !== "Amazing |grac|e") throw new Error(pieces.join("|"));
  });

  await step("the Editor shows the same beats under the words: beat 3 placed by hand", async () => {
    await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await page.getByTestId("structured-editor").waitFor();
    await page.locator('[data-sv-beat="3"][data-bar="0"][data-placed] .sv-beat-dot').waitFor();
    // The bar line moved onto how: bar 2 starts there, its beats under "sweet the sound".
    if ((await page.locator('[data-sv-beat][data-bar="1"]').count()) !== 3) throw new Error(`${await page.locator('[data-sv-beat][data-bar="1"]').count()} beats in bar 2`);
  });

  await step("in the Editor: beat 3 tapped twice goes back to the grid's place; beat 2 tapped, then a letter, placed; saved", async () => {
    const dot = (bar, beat) => page.locator(`[data-sv-beat="${beat}"][data-bar="${bar}"] .sv-beat-dot`);
    await dot(0, 3).click();
    await page.locator('[data-sv-beat="3"][data-bar="0"].sv-beat-picked .sv-beat-dot').waitFor();
    await dot(0, 3).click();
    await page.locator('[data-sv-beat="3"][data-bar="0"][data-placed] .sv-beat-dot').waitFor({ state: "detached" });
    await dot(0, 2).click();
    // The r of grace: letter 9 of the line.
    const r = await page.evaluate(() => {
      const p = document.querySelector("[data-testid=structured-editor] p[data-sv-line]");
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest(".sv-chord, .sv-chord-gap, .sv-bar")) continue;
        if (9 < n + node.data.length) {
          const range = document.createRange();
          range.setStart(node, 9 - n);
          range.setEnd(node, 10 - n);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        n += node.data.length;
      }
      return null;
    });
    await page.mouse.click(r.x, r.y);
    await page.locator('[data-sv-beat="2"][data-bar="0"][data-placed] .sv-beat-dot').waitFor();
    await page.getByRole("button", { name: "Save song" }).first().click();
    await page.getByText("Saved.", { exact: true }).waitFor();
    const saved = await api(me, "GET", `/song-versions/${song.id}`);
    const anchors = (saved.documentJson.sections[0].rhythm.bars[0].beatAnchors ?? []).map((anchor) => `${anchor.beat}@${anchor.at}`);
    if (anchors.join(" ") !== "2@9") throw new Error(anchors.join(" "));
  });

  await step("Live, presenting: Follow the music moves the slides on with the click", async () => {
    await page.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await page.goto(`${WEB}/sets/${set.id}/live/${items[0].id}`);
    const control = page.getByTestId("sync-control").first();
    await control.click();
    await page.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await page.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await page.getByTestId("sync-menu").getByRole("menuitem", { name: "Lead the set" }).click();
    await page.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await control.click();
    await page.getByTestId("sync-present").click();
    await page.locator('[data-testid="present-panel"][data-slide="0"]').waitFor();
    await page.getByTestId("present-follow").click();
    // Nothing plays yet: it waits.
    await page.getByTestId("present-follow").getByText("Waiting for the music").waitFor();
    await page.getByTestId("metronome-song").click();
    // 240 BPM: the verse's third line starts at beat 16 (4 s), its slide 2 beats before; the chorus at beat 32.
    await page.locator('[data-testid="present-panel"][data-slide="1"]').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="present-panel"][data-slide="2"]').waitFor({ timeout: 15000 });
  });

  await step("Previous takes it in hand: no longer following", async () => {
    await page.getByTestId("present-previous").click();
    if ((await page.getByTestId("present-follow").getAttribute("aria-pressed")) !== "false") throw new Error("still following");
    await page.locator('[data-testid="present-panel"][data-slide="1"]').waitFor();
    await page.waitForTimeout(2000);
    if ((await page.getByTestId("present-panel").getAttribute("data-slide")) !== "1") throw new Error("moved on by itself");
    await page.getByTestId("metronome-song").click();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
