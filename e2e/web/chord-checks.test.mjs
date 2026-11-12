// Chords that seem out of place (issue #356): in the song editor, a chord
// outside the song's key (and what songs in it often borrow) is marked on
// the chart and listed above it, with why in words and what it might be.
// Use puts the suggestion in, Keep leaves it and stops marking it (on this
// device), Show selects it. A key the chords mostly don't fit is said once,
// with Set the key. Nothing changes unless it's chosen.
import { chromium, devices } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Chord checks");
const CHART = [
  "{start_of_verse}",
  "[G]Amazing grace how [D]sweet the [Em]sound",
  "That [C]saved a [Dm]wretch like [G]me",
  "{end_of_verse}",
  "{start_of_chorus}",
  "[C]I once was [D]lost but [G]now am [Em]found",
  "[C]Was blind but [D]now I [G]see",
  "{end_of_chorus}",
  "",
].join("\n");
const newSong = (title) => api(me, "POST", "/song-versions", { title: `${title} ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: CHART, contentFormat: "CHORDPRO" });
const desk = await newSong("Chord checks");
const touchSong = await newSong("Chord checks touch");

const browser = await chromium.launch();
const errors = [];
const open = async (context, song) => {
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, me);
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  await page.getByTestId("structured-editor").waitFor();
  return page;
};
const editor = () => page.getByTestId("structured-editor");
const chords = () => editor().locator(".sv-chord").evaluateAll((els) => els.map((el) => el.dataset.svChord));
const marked = () => editor().locator("[data-out-of-place]").evaluateAll((els) => els.map((el) => el.dataset.svChord));
const same = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} (wanted ${JSON.stringify(b)})`);
};

const laptop = await browser.newContext({ viewport: { width: 1280, height: 900 } });

await step("Dm in G: marked on the chart and explained above it, with D suggested", async () => {
  await open(laptop, desk);
  const card = page.getByTestId("chord-checks");
  await card.waitFor();
  const item = card.getByTestId("chord-check");
  same(await item.count(), 1, "chords listed");
  same(await item.getAttribute("data-chord"), "Dm", "the chord listed");
  const text = await item.innerText();
  for (const words of ["isn't one of the chords of G", "G Am Bm C D Em F#dim", "It's the only Dm in the song", "Did you mean D?"]) {
    if (!text.includes(words)) throw new Error(`no "${words}" in ${JSON.stringify(text)}`);
  }
  same(await marked(), ["Dm"], "marked");
  await page.screenshot({ path: `${SP}/chord-checks.png` });
});

await step("Show selects it, its tools say why too; Use puts D in", async () => {
  await page.getByTestId("chord-check-show").click();
  const notice = page.getByTestId("chord-popover").getByTestId("chord-check-notice");
  await notice.waitFor();
  await page.screenshot({ path: `${SP}/chord-checks-popover.png` });
  await notice.getByTestId("chord-check-use").click();
  await page.waitForTimeout(100);
  same(await chords(), ["G", "D", "Em", "C", "D", "G", "C", "D", "G", "Em", "C", "D", "G"], "chords");
  same(await marked(), [], "marked after Use");
  if (await page.getByTestId("chord-checks").count()) throw new Error("the list stayed");
});

await step("undone, it's marked again; Keep stops marking it, after a reload too", async () => {
  await editor().locator("p[data-sv-line]").first().click();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  same(await marked(), ["Dm"], "marked after undo");
  await page.getByTestId("chord-checks").getByTestId("chord-check-keep").click();
  same(await marked(), [], "marked after Keep");
  if (await page.getByTestId("chord-checks").count()) throw new Error("the list stayed after Keep");
  await page.reload();
  await editor().waitFor();
  await page.waitForTimeout(300);
  same(await marked(), [], "marked after a reload");
});

await step("a key the chords don't fit: said once, and Set the key changes only the key", async () => {
  await page.getByTestId("editor-key").selectOption("Ab");
  const key = page.getByTestId("chord-checks").getByTestId("chord-check-key");
  await key.waitFor();
  const text = await page.getByTestId("chord-checks").innerText();
  if (!/aren't in Ab, but nearly all are in G/.test(text)) throw new Error(text);
  same(await marked(), [], "chords marked against the wrong key");
  await key.getByTestId("chord-check-set-key").click();
  same(await page.getByTestId("editor-key").inputValue(), "G", "the key");
  same(await chords(), ["G", "D", "Em", "C", "Dm", "G", "C", "D", "G", "Em", "C", "D", "G"], "chords after Set the key");
  await page.close();
});

await step("on a tablet: Show selects it, the chord bar says why, Use puts D in", async () => {
  await open(await browser.newContext({ ...devices["iPad (gen 7)"] }), touchSong);
  await page.getByTestId("chord-checks").getByTestId("chord-check-show").tap();
  const notice = page.getByTestId("chord-bar").getByTestId("chord-check-notice");
  await notice.waitFor();
  await page.screenshot({ path: `${SP}/chord-checks-tablet.png` });
  // Clicked as the page has it: in the emulated tablet the page can be wider than the screen, zoomed out, and a tap's
  // point then lands on the sidebar (a quirk of the emulation, not of the bar).
  await notice.getByTestId("chord-check-use").dispatchEvent("click");
  await page.waitForTimeout(100);
  same(await marked(), [], "marked after Use");
  if (!(await chords()).every((raw) => raw !== "Dm")) throw new Error(JSON.stringify(await chords()));
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
