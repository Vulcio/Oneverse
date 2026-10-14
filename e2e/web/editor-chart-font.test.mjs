// The editor in the chart's own lettering (issue #249): whatever font Edit's
// Display settings give it, proportional or monospace, each chord stays over
// its own character - where two chords are closer than the first one is
// wide, the room between them is measured, not counted in characters.
import { chromium } from "playwright";
import { WEB, SP, api, displaySetting, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Chart font editor");
// Chords crowded together, wide ones over narrow letters.
const CHART = "{start_of_verse}\n[Gsus4]I [Cmaj7]li[Dm7b5]ft my [G]eyes\nWide [Ebmaj7]words [F#m7]in [B]a row\n{end_of_verse}\n";
const song = await api(me, "POST", "/song-versions", { title: `Chart font ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: CHART, contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);

/** Each chord's chip against the character it's pinned to, and whether chips on a line overlap. */
const placement = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid=structured-editor] p[data-sv-line]")].map((line) => {
      const chips = [...line.querySelectorAll(".sv-chord")].map((chord) => {
        const chip = chord.querySelector(".sv-chord-chip").getBoundingClientRect();
        // The character after the chord (its text node's first letter).
        let next = chord.nextSibling;
        while (next && next.nodeType !== Node.TEXT_NODE) next = next.nextSibling;
        const range = document.createRange();
        if (next && next.length) {
          range.setStart(next, 0);
          range.setEnd(next, 1);
        }
        const letter = next && next.length ? range.getBoundingClientRect() : null;
        return { chord: chord.dataset.svChord, left: chip.left, right: chip.right, letter: letter?.left ?? null };
      });
      const overlaps = chips.slice(1).filter((chip, i) => chip.left < chips[i].right - 1).map((chip) => chip.chord);
      const off = chips.filter((chip) => chip.letter !== null && Math.abs(chip.left - chip.letter) > 4).map((chip) => `${chip.chord} ${Math.round(chip.left)}/${Math.round(chip.letter)}`);
      return { overlaps, off };
    }),
  );
const check = async (what) => {
  await page.waitForTimeout(300);
  const lines = await placement();
  const bad = lines.filter((line) => line.overlaps.length || line.off.length);
  if (bad.length) throw new Error(`${what}: ${JSON.stringify(bad)}`);
};

await page.goto(`${WEB}/library/${song.id}?tab=editor`);
await page.locator(".ProseMirror").waitFor();

await step("monospace (the default): every chord over its letter, none overlapping", async () => {
  await check("mono");
});

await step("the chart's other lettering, from Edit's Display settings: measured, still over their letters", async () => {
  await page.getByTestId("editor-toolbar").getByRole("radio", { name: "Preview" }).click();
  await displaySetting(page, "text", "display-font-sans");
  await page.getByTestId("editor-toolbar").getByRole("radio", { name: "Visual" }).click();
  const family = await page.locator(".sv-editor .ProseMirror").evaluate((el) => getComputedStyle(el).fontFamily);
  if (/mono/i.test(family)) throw new Error(family);
  await check("sans");
  await page.screenshot({ path: `${SP}/editor-chart-font.png` });
});

await step("transposed: the chords change, and still sit over their letters", async () => {
  for (let i = 0; i < 3; i++) await page.getByTestId("editor-transpose-up").click();
  await check("transposed");
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
