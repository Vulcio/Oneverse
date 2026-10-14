// The structured song editor (docs/song-document-v2.md, "Editor rules"):
// chords drawn over their characters, lyric edits that carry chords along
// and never lose them, dragging and nudging chords, typing and pasting
// charts, sections, text mode - and every ID surviving the save.
import { chromium } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Structured editor");
const CHART =
  "{start_of_verse}\n[G]Amazing grace how [G7]sweet the [C]sound\nThat [G]saved a [Em]wretch like [D]me\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n";
const song = await api(me, "POST", "/song-versions", { title: `Structured ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: CHART, contentFormat: "CHORDPRO" });
const stored = async () => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;
const original = await stored();
const lineOf = (doc, s, l) => doc.sections[s].lines[l];
const chordsOf = (line) => line.chords.map((c) => `${c.raw}@${c.at}`).join(" ");

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);

const editor = () => page.getByTestId("structured-editor");
const chip = (raw, nth = 0) => editor().locator(`[data-sv-chord="${raw}"] .sv-chord-chip`).nth(nth);

/** Puts the cursor (or a selection) at character offsets of the n-th line's lyrics. */
async function select(line, from, to = from) {
  await editor().focus();
  await page.evaluate(
    ([line, from, to]) => {
      const p = document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")[line];
      const texts = [];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement.closest(".sv-chord, .sv-chord-gap")) texts.push(node);
      }
      const at = (offset) => {
        for (const node of texts) {
          if (offset <= node.length) return [node, offset];
          offset -= node.length;
        }
        const last = texts.at(-1);
        return [last, last.length];
      };
      const [a, b] = [at(from), at(to)];
      window.getSelection().setBaseAndExtent(a[0], a[1], b[0], b[1]);
    },
    [line, from, to],
  );
  await page.waitForTimeout(50);
}

/** A line's lyrics as shown, without its chords. */
const lyrics = (line) =>
  page.evaluate((line) => {
    const p = document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")[line];
    let text = "";
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement.closest(".sv-chord, .sv-chord-gap")) text += node.data;
    }
    return text;
  }, line);

/** The screen box of one lyric character. */
async function charBox(line, offset) {
  return page.evaluate(
    ([line, offset]) => {
      const p = document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")[line];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest(".sv-chord, .sv-chord-gap")) continue;
        if (offset < node.length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const r = range.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        }
        offset -= node.length;
      }
      return null;
    },
    [line, offset],
  );
}

async function save() {
  await page.getByRole("button", { name: "Save song" }).first().click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
}

async function openEditor() {
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  await page.waitForLoadState("networkidle");
  await editor().waitFor();
}

await step("chords sit over the characters they're pinned to", async () => {
  await openEditor();
  const [g7, s] = [await chip("G7").boundingBox(), await charBox(0, 18)];
  if (Math.abs(g7.x + g7.width * 0 - s.x) > 4) throw new Error(`G7 chip at ${g7.x}, "s" at ${s.x}`);
  if (g7.y + g7.height > s.y + 2) throw new Error("G7 isn't above its line");
  await page.screenshot({ path: `${SP}/structured-editor.png`, fullPage: true });
});

await step("typing before a chord carries it along; typing after one doesn't", async () => {
  await select(0, 18);
  await page.keyboard.type("so ");
  await select(1, 29);
  await page.keyboard.type("!");
  const text = await lyrics(0);
  if (!text.includes("how so sweet")) throw new Error(text);
});

await step("deleting words that carry chords keeps the chords", async () => {
  // "That [G]saved a [Em]wretch": G goes with "saved a " and comes back where it was cut, before Em.
  await select(1, 5, 13);
  await page.keyboard.press("Backspace");
  await chip("G", 1).waitFor();
  await chip("Em").waitFor();
});

await step("a chord moves one character at a time with the arrow keys", async () => {
  await chip("C").click();
  await page.getByTestId("chord-popover").waitFor();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
});

await step("a chord is dragged onto another character, which lights up", async () => {
  const from = await chip("D").boundingBox();
  const target = await charBox(0, 0); // "A" of "Amazing"
  const grab = { x: 3, y: from.height / 2 };
  await page.mouse.move(from.x + grab.x, from.y + grab.y);
  await page.mouse.down();
  const to = { x: target.x + grab.x + 1, y: target.y - from.height + grab.y - 2 };
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await editor().locator(".sv-drop-target").waitFor();
  await page.mouse.up();
  if ((await editor().locator(".sv-drop-target").count()) !== 0) throw new Error("the drop highlight stayed");
});

await step("typing [Am] adds a chord; Enter splits a line and its chords go with their words", async () => {
  await select(0, 0);
  await page.keyboard.type("[Am]");
  await chip("Am").waitFor();
  const line = await lyrics(1);
  if (!line.startsWith("That wretch like")) throw new Error(line);
  await select(1, "That wretch ".length);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
});

await step("a palette chord is added where the cursor is", async () => {
  await select(1, 3);
  await page.locator('[data-palette-chord="Bm"]').first().click();
  await chip("Bm").waitFor();
  // Added selected: Delete takes it away again.
  await page.keyboard.press("Delete");
  await chip("Bm").waitFor({ state: "detached" });
});

await step("the popover changes a chord's symbol from the key's chords, and deletes one", async () => {
  await chip("G7").click();
  const popover = page.getByTestId("chord-popover");
  await popover.getByRole("button", { name: /^Em/ }).click();
  await chip("Em", 0).waitFor();
  await chip("C", 1).click();
  await popover.getByRole("button", { name: "Delete chord" }).click();
  await popover.waitFor({ state: "hidden" });
});

await step("saving keeps every ID, and the edits are what was stored", async () => {
  await save();
  const doc = await stored();
  const [before, after] = [original.sections[0], doc.sections[0]];
  const first = after.lines[0];
  if (first.text !== "Amazing grace how so sweet the sound") throw new Error(first.text);
  // G7 became Em (same ID), moved with "sweet"; C nudged one right; D dragged to "A", Am typed there first.
  const byId = Object.fromEntries(first.chords.map((c) => [c.id, c]));
  const [g, g7, c] = before.lines[0].chords;
  if (byId[g.id]?.at !== 0 || byId[g7.id]?.raw !== "Em" || byId[g7.id]?.at !== 21 || byId[c.id]?.at !== 32) throw new Error(chordsOf(first));
  const d = before.lines[1].chords.find((chord) => chord.raw === "D");
  if (byId[d.id]?.at !== 0) throw new Error(`D wasn't dragged to the start: ${chordsOf(first)}`);
  if (!first.chords.some((chord) => chord.raw === "Am" && chord.at === 0)) throw new Error(chordsOf(first));
  const [second, third] = [after.lines[1], after.lines[2]];
  if (second.id !== before.lines[1].id || second.text !== "That wretch " || third.text !== "like me!") throw new Error(JSON.stringify(after.lines));
  if (before.lines.some((line) => line.id === third.id)) throw new Error("the new line kept an old ID");
  // The deleted words' chords are gathered where they were cut, in order; "me!" after "me" didn't move D (it was dragged).
  if (chordsOf(second) !== `G@5 Em@5`) throw new Error(chordsOf(second));
  if (second.chords[0].id !== before.lines[1].chords[0].id) throw new Error("G lost its ID");
  // The chorus's C was deleted on purpose; G stays.
  if (chordsOf(doc.sections[1].lines[0]) !== "G@14") throw new Error(chordsOf(doc.sections[1].lines[0]));
  if (doc.sections.map((s) => s.id).join() !== original.sections.map((s) => s.id).join()) throw new Error("section IDs changed");
});

await step("undo takes back the last edit", async () => {
  await openEditor();
  await select(2, 0);
  await page.keyboard.type("Oh ");
  await page.keyboard.press("Control+z");
  const text = await lyrics(2);
  if (text.includes("Oh")) throw new Error(text);
});

await step("pasting a chart adds its sections; pasting words just types them", async () => {
  const paste = (text) =>
    editor().evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
  await select(3, 1000);
  await paste("{start_of_bridge}\n[Em]Through many [C]dangers\n{end_of_bridge}\n\n{start_of_tag}\n[G]Amen\n{comment: Softly [x2]}\n{end_of_tag}");
  await chip("Em", 1).waitFor();
  const pasted = await editor().locator("[data-section-type]").evaluateAll((els) => els.map((el) => el.dataset.sectionType).join());
  if (pasted !== "verse,chorus,bridge,tag") throw new Error(`sections: ${pasted}`);
  const note = await editor().locator('p[data-kind="note"]').innerText();
  if (note !== "Softly [x2]") throw new Error(`the comment isn't a note line: ${note}`);
  await select(0, 0);
  await paste("Oh ");
  const text = await lyrics(0);
  if (!text.includes("Oh Amazing")) throw new Error(text);
});

await step("a section can be retyped, relabelled, duplicated and deleted", async () => {
  const bridge = editor().locator('[data-section-type="bridge"]');
  await bridge.getByLabel("Section label").fill("Bridge A");
  await bridge.hover();
  await bridge.getByRole("button", { name: /actions$/ }).click();
  await page.getByRole("menuitem", { name: "Duplicate (unique copy)" }).click();
  if ((await editor().locator('[data-section-type="bridge"]').count()) !== 2) throw new Error("not duplicated");
  const copy = editor().locator('[data-section-type="bridge"]').nth(1);
  await copy.getByLabel("Section type").selectOption("outro");
  await editor().locator('[data-section-type="outro"]').waitFor();
  await editor().locator('[data-section-type="tag"]').hover();
  await editor().locator('[data-section-type="tag"]').getByRole("button", { name: /actions$/ }).click();
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  await save();
  const doc = await stored();
  const types = doc.sections.map((s) => s.type).join();
  if (types !== "verse,chorus,bridge,outro") throw new Error(types);
  const [bridgeSection, outro] = [doc.sections[2], doc.sections[3]];
  if (bridgeSection.label !== "Bridge A" || outro.id === bridgeSection.id || outro.lines[0].id === bridgeSection.lines[0].id) throw new Error(JSON.stringify(doc.sections.slice(2)));
  if (outro.lines[0].chords[0].id === bridgeSection.lines[0].chords[0].id) throw new Error("the copy shares chord IDs");
  if (doc.sections.some((section) => section.type === "tag")) throw new Error("the tag wasn't deleted");
  if (doc.flow.map((item) => item.sectionId).join() !== doc.sections.map((s) => s.id).join()) throw new Error("flow doesn't follow the sections");
});

await step("text mode edits the chart as ChordPro; IDs survive the way back", async () => {
  const before = await stored();
  await page.getByRole("radio", { name: "Text" }).click();
  const box = page.getByTestId("structured-editor-text");
  const text = await box.inputValue();
  if (!text.includes("{start_of_chorus}")) throw new Error(text);
  await box.fill(text.replace("[G]gone", "[D]gone"));
  await page.getByRole("radio", { name: "Visual" }).click();
  await chip("D").waitFor();
  await save();
  const doc = await stored();
  const [was, now] = [lineOf(before, 1, 0), lineOf(doc, 1, 0)];
  if (now.id !== was.id || now.chords[0].id !== was.chords[0].id || now.chords[0].raw !== "D") throw new Error(JSON.stringify({ was, now }));
});

await step("transposing moves every chord and the key", async () => {
  await page.getByRole("button", { name: "Transpose up a semitone" }).click();
  await chip("Eb").waitFor();
  const key = await page.getByRole("combobox", { name: "Key", exact: true }).inputValue();
  if (key !== "Ab") throw new Error(key);
  await page.getByRole("button", { name: "Transpose down a semitone" }).click();
  await chip("D").waitFor();
});

await step("the song order: sing the chorus again, in a new key, with a note for the band", async () => {
  const order = page.getByTestId("song-order");
  if ((await order.locator("li button").count()) !== 4) throw new Error("the order doesn't start as the four sections");
  const chorusId = (await stored()).sections[1].id;
  await order.getByLabel("Add a pass").selectOption(chorusId);
  const pass = page.getByTestId("song-order-pass");
  // The pass's name, key change and note: each from the pass bar, in a small form over the page (issue #251).
  await pass.getByTestId("pass-rename").click();
  await page.getByRole("textbox", { name: "Label for this pass" }).fill("Last chorus");
  await page.keyboard.press("Escape");
  await pass.getByTestId("pass-key-change").click();
  await page.getByRole("combobox", { name: "Key change" }).selectOption("2");
  await page.keyboard.press("Escape");
  await pass.getByTestId("pass-note").click();
  await page.getByRole("textbox", { name: "Note for the band" }).fill("All in");
  await page.keyboard.press("Escape");
  await order.getByRole("button", { name: /Last chorus/ }).getByText("→A").waitFor();
  // Moved up one, then back to the end.
  await pass.getByRole("button", { name: "Earlier" }).click();
  await pass.getByRole("button", { name: "Later" }).click();
  await page.getByRole("radio", { name: "Preview" }).click();
  const last = page.locator("[data-pass]").last();
  await last.getByText("Last chorus").waitFor();
  await last.locator('[data-key-change="A"]').waitFor();
  await last.getByText("All in").waitFor();
  // The chorus's D, two semitones up.
  await last.locator('[data-chord="E"]').first().waitFor();
  await page.getByRole("radio", { name: "Visual" }).click();
  await save();
  const doc = await stored();
  const added = doc.flow.at(-1);
  if (doc.flow.length !== 5 || added.sectionId !== chorusId || added.label !== "Last chorus" || added.note !== "All in" || added.keyChange?.steps !== 2 || added.keyChange?.key !== "A") {
    throw new Error(JSON.stringify(doc.flow));
  }
});

await step("changing the song's key renames the key changes after it", async () => {
  await page.getByRole("combobox", { name: "Key", exact: true }).selectOption("A");
  await page.getByTestId("song-order").getByRole("button", { name: /Last chorus/ }).getByText("→B").waitFor();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByTestId("song-order").getByRole("button", { name: /Last chorus/ }).getByText("→A").waitFor();
});

await step("an edit made the moment a save finishes isn't lost when the song reloads (#39)", async () => {
  const key = page.getByRole("combobox", { name: "Key", exact: true });
  await key.selectOption("A");
  await page.getByRole("button", { name: "Save song" }).first().click();
  // The editor is disabled while saving, so this lands as soon as the save
  // ends - before the page has reloaded the saved song.
  await key.selectOption("C");
  // (Editing clears the "Saved." message, so wait on the song itself.)
  for (let i = 0; i < 50 && (await stored()).defaults.key !== "A"; i++) await page.waitForTimeout(100);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  if ((await stored()).defaults.key !== "A") throw new Error(`stored key ${(await stored()).defaults.key}`);
  if ((await key.inputValue()) !== "C") throw new Error(`the edit was lost: key ${await key.inputValue()}`);
  if (await page.getByRole("button", { name: "Discard changes" }).isDisabled()) throw new Error("the edit isn't shown as unsaved");
  await page.getByRole("button", { name: "Discard changes" }).click();
  if ((await key.inputValue()) !== "A") throw new Error("discarding goes back to the saved song");
});

// Drags with the mouse from one element to a point, in small steps.
async function dragTo(from, x, y) {
  const box = await from.boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 15 });
}

await step("a palette chord dragged onto a lyric lands on it", async () => {
  await openEditor();
  const line = await editor().locator("p[data-sv-line]").nth(1).boundingBox();
  const before = await editor().locator('[data-sv-chord="Bm"]').count();
  await dragTo(page.locator('[data-palette-chord="Bm"]').first(), line.x + 5, line.y - 10);
  await editor().locator(".sv-drop-target").waitFor();
  await page.mouse.up();
  await editor().locator('[data-sv-chord="Bm"]').nth(before).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Discard changes" }).click();
});

await step("a section added from the + between two sections goes there; the + above the first, before it", async () => {
  await openEditor();
  const types = () => editor().locator("[data-section-type]").evaluateAll((els) => els.map((el) => el.dataset.sectionType));
  const before = await types();
  // The "+" over the gap below the first section.
  await editor().locator("[data-section-type]").first().getByTestId("section-insert").click();
  await page.getByTestId("section-inserter-menu").locator('[data-insert-type="bridge"]').click();
  await page.waitForTimeout(200);
  const after = await types();
  const expected = [before[0], "bridge", ...before.slice(1)];
  if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  await page.getByTestId("section-insert-top").click();
  await page.getByTestId("section-inserter-menu").locator('[data-insert-type="intro"]').click();
  await page.waitForTimeout(200);
  if ((await types())[0] !== "intro") throw new Error(JSON.stringify(await types()));
});

await step("from the + at the end: a section of the song sung again there, as a linked copy", async () => {
  const copies = await editor().getByTestId("linked-copy").count();
  await page.getByTestId("section-insert-end").click();
  const menu = page.getByTestId("section-inserter-menu");
  // The new, empty sections aren't offered: there's nothing in them to sing again.
  await menu.getByRole("menuitem", { name: "Chorus", exact: true }).last().click();
  await editor().getByTestId("linked-copy").nth(copies).waitFor();
  await page.getByRole("button", { name: "Discard changes" }).click();
});

await step("a section's tools show on the section being edited, in room kept for them", async () => {
  await openEditor();
  const first = editor().locator("[data-section-type]").first();
  const name = await first.getByTestId("section-name").boundingBox();
  await select(0, 2);
  await first.locator("[data-section-tools]").getByRole("button", { name: /actions$/ }).waitFor({ state: "visible" });
  const after = await first.getByTestId("section-name").boundingBox();
  if (Math.round(name.y) !== Math.round(after.y) || Math.round(name.x) !== Math.round(after.x)) throw new Error(`the heading moved: ${JSON.stringify({ name, after })}`);
  // Its colour: a tag and a wash in its type's colour.
  const tag = await first.getByTestId("section-type").evaluate((el) => getComputedStyle(el).backgroundColor);
  if (!tag || tag === "rgba(0, 0, 0, 0)") throw new Error(`no colour: ${tag}`);
});

await step("on a phone: the palette scrolls sideways, a tapped chord opens its details", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(`${overflow}px sideways scroll`);
  await chip("Em").click();
  const popover = await page.getByTestId("chord-popover").boundingBox();
  if (popover.x < 0 || popover.x + popover.width > 390) throw new Error(`popover off screen: ${JSON.stringify(popover)}`);
  await page.screenshot({ path: `${SP}/structured-editor-phone.png`, fullPage: true });
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join("\n"));
});

await browser.close();
finish();
