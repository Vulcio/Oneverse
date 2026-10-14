// The chords while editing (issue #253): with a mouse, a panel at the right
// of the chart that stays in view; on a touch screen, a bar along the
// bottom of the screen - over the phone's save bar - where a tap adds a
// chord at the cursor or puts it in place of the one selected. A finger
// holds a chord a moment to drag it; a quick swipe scrolls instead (#32).
import { chromium, devices } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Chord bar");
const CHART = "{start_of_verse}\n[G]Amazing grace how sweet the sound\nThat saved a [Em]wretch like me\n{end_of_verse}\n";
const song = await api(me, "POST", "/song-versions", { title: `Chord bar ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: CHART, contentFormat: "CHORDPRO" });

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
const chords = () => editor().locator(".sv-chord").evaluateAll((els) => els.map((el) => el.dataset.svChord));
/** Puts the cursor at a character of the n-th line's lyrics. */
const cursorAt = (line, offset) =>
  page.evaluate(
    ([line, offset]) => {
      const p = document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")[line];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest(".sv-chord, .sv-chord-gap")) continue;
        if (offset <= node.length) {
          window.getSelection().setBaseAndExtent(node, offset, node, offset);
          return;
        }
        offset -= node.length;
      }
    },
    [line, offset],
  );

// One session for a whole gesture: the browser follows a touch from its start.
let cdp;
const touch = async (type, x, y) => {
  cdp ??= await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
};
/** In the middle of the screen, clear of the sticky header and toolbar. */
const centre = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
const chipBox = async (raw) => editor().locator(`[data-sv-chord="${raw}"] .sv-chord-chip`).boundingBox();

await step("with a mouse: the chords panel at the right of the chart, no bar", async () => {
  await open(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  const panel = await page.getByTestId("chord-panel").boundingBox();
  const chart = await editor().boundingBox();
  if (!panel || panel.x < chart.x + chart.width) throw new Error(`panel not at the right: ${JSON.stringify({ panel, chart })}`);
  if (await page.getByTestId("chord-bar").isVisible()) throw new Error("bar shown with a mouse");
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const scrolled = await page.getByTestId("chord-panel").boundingBox();
  if (!scrolled || scrolled.y < 0) throw new Error(`panel scrolled away: ${JSON.stringify(scrolled)}`);
  await page.close();
});

const tablet = await browser.newContext({ ...devices["iPad (gen 7)"] });
await step("on a tablet: the bar along the bottom, a tap adds a chord at the cursor", async () => {
  await open(tablet);
  if (await page.getByTestId("chord-panel").isVisible()) throw new Error("panel shown on a touch screen");
  const bar = page.getByTestId("chord-bar");
  await bar.waitFor();
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  if (Math.abs(box.y + box.height - viewport.height) > 2) throw new Error(`bar not at the bottom: ${JSON.stringify(box)}`);
  const chip = await bar.locator('[data-bar-chord="C"]').boundingBox();
  if (chip.height < 44 || chip.width < 44) throw new Error(`chip too small: ${JSON.stringify(chip)}`);
  await editor().locator("p[data-sv-line]").first().tap();
  await cursorAt(0, 8);
  await bar.locator('[data-bar-chord="C"]').tap();
  await page.waitForTimeout(100);
  if (JSON.stringify(await chords()) !== JSON.stringify(["G", "C", "Em"])) throw new Error(JSON.stringify(await chords()));
  await page.screenshot({ path: `${SP}/editor-chord-bar.png` });
});

await step("a chord selected: the bar's chord takes its place", async () => {
  await centre(editor().locator('[data-sv-chord="Em"]'));
  // Typing in the chart (its keyboard up), then a tap on a chord: chosen, and the keyboard put away so it covers nothing.
  await editor().locator("p[data-sv-line]").first().tap();
  const focused = () => page.evaluate(() => !!document.activeElement?.closest("[data-testid=structured-editor]"));
  if (!(await focused())) throw new Error("the chart isn't focused after a tap on its words");
  await editor().locator('[data-sv-chord="Em"] .sv-chord-chip').tap();
  await page.getByTestId("chord-bar").getByText("in place of Em").waitFor();
  if (await focused()) throw new Error("a tap on a chord left the chart focused: the keyboard would stay up");
  await page.getByTestId("chord-bar").locator('[data-bar-chord="Am"]').tap();
  await page.waitForTimeout(100);
  if (JSON.stringify(await chords()) !== JSON.stringify(["G", "C", "Am"])) throw new Error(JSON.stringify(await chords()));
  // No popover over the chart on a touch screen: the bar has the selected chord's tools.
  if (await page.getByTestId("chord-popover").isVisible()) throw new Error("the popover covers the chart");
  const at = await editor().locator('[data-sv-chord="Am"]').evaluate((el) => el.getBoundingClientRect().left);
  await page.getByTestId("chord-bar-right").tap();
  await page.waitForTimeout(100);
  const moved = await editor().locator('[data-sv-chord="Am"]').evaluate((el) => el.getBoundingClientRect().left);
  if (!(moved > at)) throw new Error(`not moved right: ${at} → ${moved}`);
});


await step("a finger held on a chord lifts it; dragged, it lands on another letter", async () => {
  await centre(editor().locator('[data-sv-chord="Am"]'));
  const from = await chipBox("Am");
  const before = await editor().locator('[data-sv-chord="Am"]').evaluate((el) => el.getBoundingClientRect().left);
  await touch("touchStart", from.x + 4, from.y + from.height / 2);
  await page.waitForTimeout(500);
  await page.locator(".sv-drag-ghost-lifted").waitFor();
  for (let i = 1; i <= 6; i++) await touch("touchMove", from.x + 4 - i * 12, from.y + from.height / 2);
  await touch("touchEnd");
  await page.waitForTimeout(200);
  const after = await editor().locator('[data-sv-chord="Am"]').evaluate((el) => el.getBoundingClientRect().left);
  if (!(after < before - 20)) throw new Error(`not moved: ${before} → ${after}`);
});

await step("a quick swipe from a chord doesn't drag it", async () => {
  const from = await chipBox("C");
  const before = await editor().locator('[data-sv-chord="C"]').evaluate((el) => el.getBoundingClientRect().left);
  await touch("touchStart", from.x + 4, from.y + from.height / 2);
  for (let i = 1; i <= 6; i++) await touch("touchMove", from.x + 4 + i * 15, from.y + from.height / 2);
  await touch("touchEnd");
  await page.waitForTimeout(200);
  if (await page.locator(".sv-drag-ghost").count()) throw new Error("a ghost stayed");
  const after = await editor().locator('[data-sv-chord="C"]').evaluate((el) => el.getBoundingClientRect().left);
  if (Math.abs(after - before) > 1) throw new Error(`moved: ${before} → ${after}`);
  // Undo doesn't bring the keyboard up either.
  await page.getByTestId("editor-undo").tap();
  if (await page.evaluate(() => !!document.activeElement?.closest("[data-testid=structured-editor]"))) throw new Error("Undo focused the chart");
  await page.close();
});

await step("on a phone: the bar over the save bar", async () => {
  await open(await browser.newContext({ ...devices["iPhone 13"] }));
  const bar = await page.getByTestId("chord-bar").boundingBox();
  const save = await page.getByTestId("mobile-save-bar").boundingBox();
  if (Math.abs(bar.y + bar.height - save.y) > 2) throw new Error(`bar not on the save bar: ${JSON.stringify({ bar, save })}`);
  await page.screenshot({ path: `${SP}/editor-chord-bar-phone.png` });
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
