// The Editor's chord tools and repeats (issue #457). A chord's tools close
// on a press outside them or Escape, and open again when the chord is
// pressed. A section sung again straight after, the same way, is one block
// with a counter (×3) and one more / one fewer; only a pass sung elsewhere
// or differently is a block of its own. "Separate the repeats" makes each a
// linked copy to change; the song's order keeps one pass per time sung.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Editor repeats");
const section = (id, type, text, chord) => ({ id, type, label: null, lines: [{ id: `${id}_l`, kind: "lyric", text, chords: [{ id: `${id}_c`, at: 0, raw: chord }] }] });
const [verse, chorus, bridge] = [section(`v${stamp}`, "verse", "Amazing grace", "G"), section(`c${stamp}`, "chorus", "My chains are gone", "C"), section(`b${stamp}`, "bridge", "Alleluia", "Em")];
const pass = (n, sectionId, extra = {}) => ({ id: `f${n}${stamp}`, sectionId, ...extra });
// Verse, the chorus three times, the bridge, the chorus again after it.
const flow = [pass(0, verse.id), pass(1, chorus.id), pass(2, chorus.id), pass(3, chorus.id), pass(4, bridge.id), pass(5, chorus.id)];
const song = await api(me, "POST", "/song-versions", { title: `Editor repeats ${stamp}`, language: "en", artists: ["Band"], key: "G" });
await api(me, "PATCH", `/song-versions/${song.id}`, { sections: [verse, chorus, bridge], flow });
const stored = async () => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await signIn(page, me);
  const editor = () => page.getByTestId("structured-editor");
  const block = (type) => editor().locator(`section[data-section-type="${type}"]`);
  const copy = () => editor().getByTestId("linked-copy");
  // The editor's blocks in order: sections by type, linked copies as "copy", each with its count when sung more than once.
  const blocks = async () =>
    (
      await editor()
        .locator(":scope > [data-node-view-wrapper], :scope > section, :scope > div")
        .evaluateAll((els) =>
          els.map((el) => {
            const name = el.matches("[data-linked-pass]") || el.querySelector("[data-linked-pass]") ? "copy" : (el.getAttribute("data-section-type") ?? el.querySelector("[data-section-type]")?.getAttribute("data-section-type"));
            const times = el.querySelector('[data-testid="repeat-times"]')?.textContent?.trim();
            return name ? (times ? `${name}${times}` : name) : null;
          }),
        )
    ).filter(Boolean);
  const expectBlocks = async (want) => {
    for (let i = 0; i < 20; i++) {
      if (JSON.stringify(await blocks()) === JSON.stringify(want)) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`blocks: ${JSON.stringify(await blocks())}, wanted ${JSON.stringify(want)}`);
  };
  const save = async (check) => {
    await page.getByRole("button", { name: "Save song" }).first().click();
    for (let i = 0; i < 40; i++) {
      const found = await stored();
      if (check(found)) return found;
      await page.waitForTimeout(250);
    }
    throw new Error(`not saved: ${JSON.stringify((await stored()).flow)}`);
  };

  await step("a chord's tools close on a press outside them and on Escape, and open again on the chord", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await page.waitForLoadState("networkidle");
    const popover = page.getByTestId("chord-popover");
    const chip = block("verse").locator(".sv-chord-chip").first();
    await chip.click();
    await popover.waitFor();
    // Inside the box: it stays.
    await popover.getByRole("textbox").click();
    await popover.waitFor();
    // Outside the chart and the box.
    await page.mouse.click(5, 500);
    await popover.waitFor({ state: "hidden" });
    await chip.click();
    await popover.waitFor();
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
    // Another chord: its own box, which closes the same way.
    await block("chorus").locator(".sv-chord-chip").first().click();
    await popover.waitFor();
    await page.mouse.click(5, 500);
    await popover.waitFor({ state: "hidden" });
  });

  await step("the chorus sung three times in a row is one block, ×3; sung again after the bridge, a copy", async () => {
    await expectBlocks(["verse", "chorus×3", "bridge", "copy"]);
  });

  await step("one fewer: ×2, and the song's order loses that pass", async () => {
    await block("chorus").getByTestId("repeat-fewer").click();
    await expectBlocks(["verse", "chorus×2", "bridge", "copy"]);
    const saved = await save((found) => found.flow.length === 5);
    if (saved.flow.map((item) => item.id).join() !== [0, 1, 2, 4, 5].map((n) => `f${n}${stamp}`).join()) throw new Error(JSON.stringify(saved.flow));
  });

  await step("the bridge sung again straight after: ×2 from its tools", async () => {
    await block("bridge").hover();
    await block("bridge").getByTestId("repeat-add").click();
    await expectBlocks(["verse", "chorus×2", "bridge×2", "copy"]);
    await block("bridge").getByTestId("repeat-more").click();
    await expectBlocks(["verse", "chorus×2", "bridge×3", "copy"]);
  });

  await step("a copy repeated and transposed: its repeats are sung as it is", async () => {
    await copy().hover();
    await copy().getByTestId("repeat-add").click();
    await expectBlocks(["verse", "chorus×2", "bridge×3", "copy×2"]);
    await copy().getByTestId("linked-toggle").click();
    await copy().getByTestId("linked-transpose-up").click();
    await copy().getByTestId("linked-transpose").getByText("+1").waitFor();
    const saved = await save((found) => found.flow.length === 8 && found.flow.at(-1).transpose === 1);
    const kinds = saved.flow.map((item) => [verse.id, chorus.id, bridge.id].indexOf(item.sectionId)).join("");
    if (kinds !== "01122211") throw new Error(kinds);
    if (saved.flow.at(-2).transpose !== 1 || saved.flow.at(-2).id !== `f5${stamp}`) throw new Error(JSON.stringify(saved.flow.slice(-2)));
    if (new Set(saved.flow.map((item) => item.id)).size !== 8) throw new Error("a pass twice");
  });

  await step("Separate the repeats: the second chorus a copy of its own, to change", async () => {
    await block("chorus").hover();
    await block("chorus").getByRole("button", { name: "Chorus actions" }).click();
    await page.getByTestId("repeat-separate").click();
    await expectBlocks(["verse", "chorus", "copy", "bridge×3", "copy×2"]);
    await copy().first().getByText("Linked to Chorus").waitFor();
  });

  await step("opened again, a copy sung the same way straight after folds back into the counter", async () => {
    // Nothing to save: the song's order is the same, one pass each time.
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await page.waitForLoadState("networkidle");
    await expectBlocks(["verse", "chorus×2", "bridge×3", "copy×2"]);
  });

  await step("down to one: the counter goes", async () => {
    await block("bridge").getByTestId("repeat-fewer").click();
    await block("bridge").getByTestId("repeat-fewer").click();
    await expectBlocks(["verse", "chorus×2", "bridge", "copy×2"]);
    await save((found) => found.flow.length === 6);
  });
} finally {
  await browser.close();
}
finish();
