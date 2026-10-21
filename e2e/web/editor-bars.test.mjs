// Bar lines in the editor (issue #238): where each bar starts, placed in the words as a lead sheet marks them. The
// Bars menu fills them in from the chords; a bar line is dragged by its knob (a finger holds it a moment first),
// nudged a letter at a time, given bars after it (a held word) and deleted; "|" typed in the words adds one. They're
// saved as each section's rhythm, which the bars row and the chord grid read. Screenshots go to e2e/.artifacts.
import { chromium, devices } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Bar lines");
const CHART =
  "{start_of_verse}\n[G]Amazing [C]grace how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\nI once was lost\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n";
const song = await api(me, "POST", "/song-versions", { title: `Bar lines ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 120, timeSignature: "4/4", content: CHART, contentFormat: "CHORDPRO" });
const stored = async () => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;

const browser = await chromium.launch();
const errors = [];
const open = async (context) => {
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, me);
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  await page.getByTestId("structured-editor").waitFor();
  return page;
};
const editor = () => page.getByTestId("structured-editor");
const bars = () => editor().locator("[data-sv-bar]");
/** Each line's lyrics with "|" where its bar lines stand (and "×n" for more bars). */
const marked = () =>
  editor().evaluate((root) =>
    [...root.querySelectorAll("p[data-sv-line]")].map((p) => {
      let text = "";
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) {
            if (!child.parentElement.closest(".sv-chord, .sv-chord-gap, .sv-bar")) text += child.data;
          } else if (child.classList?.contains("sv-bar")) text += child.dataset.bars === "1" ? "|" : `|×${child.dataset.bars}`;
          else if (!child.classList?.contains("sv-chord")) walk(child);
        }
      };
      walk(p);
      return text;
    }),
  );
/** The screen box of one lyric character of the n-th line. */
const charBox = (line, offset) =>
  page.evaluate(
    ([line, offset]) => {
      const p = document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")[line];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest(".sv-chord, .sv-chord-gap, .sv-bar")) continue;
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
const knob = async (nth) => bars().nth(nth).locator(".sv-bar-knob").boundingBox();
async function save() {
  await page.getByRole("button", { name: "Save song" }).first().click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
}

try {
  await step("the Bars menu fills the bar lines in from the chords: one before each chord, a line without two bars", async () => {
    await open(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
    await page.getByTestId("editor-bars").click();
    await page.getByTestId("bars-fill-song").click();
    await bars().first().waitFor();
    const lines = await marked();
    const expected = ["|Amazing |grace how |sweet the |sound", "|That saved a |wretch like |me", "|×2I once was lost", "|My chains are |gone"];
    if (JSON.stringify(lines) !== JSON.stringify(expected)) throw new Error(JSON.stringify(lines));
    await page.screenshot({ path: `${SP}/editor-bars.png` });
  });

  await step("saved as the sections' rhythm: a bar where each bar line stands", async () => {
    await save();
    const doc = await stored();
    const verse = doc.sections[0].rhythm;
    if (verse?.bars.length !== 9) throw new Error(JSON.stringify(verse));
    const anchors = verse.bars.map((bar) => (bar.lyricAnchor ? bar.lyricAnchor.at : "-")).join(" ");
    if (anchors !== "0 8 18 28 0 13 25 0 -") throw new Error(anchors);
    if (doc.sections[1].rhythm?.bars.length !== 2) throw new Error("the chorus's bars");
  });

  await step("dragged by its knob with a mouse: it lands between the letters it's let go at", async () => {
    // The verse's second bar line, before "grace", dragged to before "how" (character 14).
    const from = await knob(1);
    const to = await charBox(0, 14);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(to.x + 1, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    const [line] = await marked();
    if (line !== "|Amazing grace |how |sweet the |sound") throw new Error(line);
  });

  await step("a click selects it: its tools under it - a letter left, one more bar, and back", async () => {
    await bars().nth(1).click();
    const popover = page.getByTestId("bar-popover");
    await popover.waitFor();
    await popover.getByTestId("bar-left").click();
    if ((await marked())[0] !== "|Amazing grace| how |sweet the |sound") throw new Error((await marked())[0]);
    await page.keyboard.press("ArrowRight");
    await popover.getByTestId("bar-more").click();
    if ((await popover.getByTestId("bar-count").innerText()) !== "2 bars") throw new Error("not 2 bars");
    if ((await marked())[0] !== "|Amazing grace |×2how |sweet the |sound") throw new Error((await marked())[0]);
    await page.screenshot({ path: `${SP}/editor-bars-popover.png` });
    await popover.getByTestId("bar-fewer").click();
    await popover.getByTestId("bar-delete").click();
    if ((await marked())[0] !== "|Amazing grace how |sweet the |sound") throw new Error((await marked())[0]);
  });

  await step('"|" typed in the words adds a bar line; the palette\'s Bar line dragged onto them another', async () => {
    // The cursor before "how": a bar line typed there.
    await editor().focus();
    await page.evaluate(() => {
      const p = document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")[0];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let offset = 14;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest(".sv-chord, .sv-chord-gap, .sv-bar")) continue;
        if (offset <= node.length) return window.getSelection().setBaseAndExtent(node, offset, node, offset);
        offset -= node.length;
      }
    });
    await page.keyboard.type("|");
    if ((await marked())[0] !== "|Amazing grace |how |sweet the |sound") throw new Error((await marked())[0]);
    // From the panel at the right, onto "saved" in the second line.
    const chip = await page.getByTestId("chord-panel").getByTestId("bar-new").boundingBox();
    const to = await charBox(1, 5);
    await page.mouse.move(chip.x + 10, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(chip.x - 40, chip.y, { steps: 4 });
    await page.mouse.move(to.x + 1, to.y + to.height + 6, { steps: 12 });
    await page.mouse.up();
    if ((await marked())[1] !== "|That |saved a |wretch like |me") throw new Error((await marked())[1]);
  });

  await step("saved, the chord grid reads the bars as placed", async () => {
    await save();
    const verse = (await stored()).sections[0].rhythm;
    const bar = verse.bars.find((one) => one.lyricAnchor?.at === 14);
    if (!bar) throw new Error(JSON.stringify(verse.bars.map((one) => one.lyricAnchor)));
    await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
    await page.goto(`${WEB}/library/${song.id}`);
    await page.getByTestId("chart-view-grid").click();
    const grid = page.getByTestId("chord-grid");
    await grid.waitFor();
    const words = (await grid.locator("[data-grid-words]").allInnerTexts()).map((one) => one.trim());
    if (words.slice(0, 5).join(" / ") !== "Amazing grace / how / sweet the / sound / That") throw new Error(words.join(" / "));
    await page.getByTestId("chart-view-chart").click();
    await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  });

  await step("the Bars menu takes them away: the bars come from the chords again", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=editor`);
    await bars().first().waitFor();
    await page.getByTestId("editor-bars").click();
    await page.getByTestId("bars-clear-song").click();
    await bars().first().waitFor({ state: "detached" });
    await save();
    if ((await stored()).sections.some((section) => section.rhythm)) throw new Error("a rhythm is left");
    // Back for the phone's steps.
    await page.getByTestId("editor-bars").click();
    await page.getByTestId("bars-fill-song").click();
    await save();
  });

  // One session for a whole gesture: the browser follows a touch from its start.
  let cdp;
  const touch = async (type, x, y) => {
    cdp ??= await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  };

  await step("on a phone: a tap selects a bar line, its tools in the bar along the bottom", async () => {
    await open(await browser.newContext({ ...devices["iPhone 13"] }));
    await bars().nth(1).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await bars().nth(1).tap();
    const tools = page.getByTestId("bar-tools");
    await tools.waitFor();
    await tools.getByTestId("bar-right").tap();
    if ((await marked())[0] !== "|Amazing g|race how |sweet the |sound") throw new Error((await marked())[0]);
    await tools.getByTestId("bar-left").tap();
    await tools.getByTestId("bar-more").tap();
    if ((await marked())[0] !== "|Amazing |×2grace how |sweet the |sound") throw new Error((await marked())[0]);
    await page.screenshot({ path: `${SP}/editor-bars-phone.png` });
    await tools.getByTestId("bar-fewer").tap();
  });

  await step("on a phone: held a moment, a bar line lifts and follows the finger", async () => {
    const from = await knob(2);
    const to = await charBox(0, 24);
    const [x, y] = [from.x + from.width / 2, from.y + from.height / 2];
    await touch("touchStart", x, y);
    await page.waitForTimeout(500);
    // Held by its knob, under the words: it stays on its line, where the finger goes.
    for (let i = 1; i <= 8; i++) await touch("touchMove", x + ((to.x + 1 - x) * i) / 8, y);
    await touch("touchEnd");
    if ((await marked())[0] !== "|Amazing |grace how sweet |the |sound") throw new Error((await marked())[0]);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
}
finish();
