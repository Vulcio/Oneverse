// Nashville numbers and chord colours (issues #9, #207 phase 2): numbers
// count from the key each part is sung in - a key change keeps them the
// same - and a capo doesn't change them; chords coloured by family. Chosen
// in Chart display, or for one mode in the Display panel - and Roman
// numerals (issue #220), the same way.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, stamp, stepper, user, displaySetting, resetDisplay } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Number reader");
const song = await api(me, "POST", "/song-versions", {
  title: `Numbers ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "D",
  capo: 2,
  content: "{key: D}\n{start_of_verse}\n[D]Glory [Em7]to the [D/F#]King of [G]kings, [A7]amen\n{end_of_verse}\n{key: E}\n{start_of_verse}\n[E]Glory [F#m7]to the [E/G#]King of [A]kings, [B7]amen\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
const set = await api(me, "POST", "/setlists", { name: `Numbers Set ${stamp}` });
const item = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items[0];

check("colours are off by default", (await api(me, "GET", "/users/me")).chordColors === false);
check("numbers and colours are the player's own settings", (await call(me, "PATCH", "/users/me", { chordNotation: "NASHVILLE", chordColors: true })).status === 200);
const saved = await api(me, "GET", "/users/me");
check("and saved", saved.chordNotation === "NASHVILLE" && saved.chordColors === true, JSON.stringify(saved));
await api(me, "PATCH", "/users/me", { chordNotation: "LETTERS", chordColors: false });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
const labels = () => page.locator("[data-chord]").evaluateAll((els) => els.map((el) => el.textContent.trim()));
// A setting on the dashboard, once its page has hydrated, and saved: chosen before, the select goes back unsaved.
async function choose(label, value) {
  const saved = page.waitForResponse((res) => res.url().endsWith("/users/me") && res.request().method() === "PATCH");
  await page.getByLabel(label).selectOption(value);
  if (!(await saved).ok()) throw new Error(`${label}: not saved`);
  await page.waitForLoadState("networkidle");
}

await step("Chart display: Nashville numbers; the key change keeps them, the capo too", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await choose("Chord names", "NASHVILLE");
  await choose("With a capo", "FINGERED");
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByTestId("practice-song").locator("[data-chord]").first().waitFor();
  // Sung in D, then in E: the same numbers both times, capo shapes or not.
  const shown = (await labels()).join(" ");
  if (shown !== "1 2m7 1/3 4 57 1 2m7 1/3 4 57") throw new Error(shown);
});

await step("Roman numerals from the Display panel (issue #220): Practice only, the key change and the capo keep them", async () => {
  await displaySetting(page, "chords", "display-notation-ROMAN");
  await page.waitForFunction(() => document.querySelector("[data-chord]")?.textContent.trim() === "I");
  const shown = (await labels()).join(" ");
  if (shown !== "I ii7 I/3 IV V7 I ii7 I/3 IV V7") throw new Error(shown);
  await resetDisplay(page);
  await page.waitForFunction(() => document.querySelector("[data-chord]")?.textContent.trim() === "1");
});

await step("Chart display: colours by chord type", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await choose("Chord colours", "ON");
  await page.goto(`${WEB}/library/${song.id}`);
  const dominant = page.locator('[data-family="dominant"]').first();
  await dominant.waitFor();
  const [red, minor] = [await dominant.evaluate((el) => getComputedStyle(el).color), await page.locator('[data-family="minor"]').first().evaluate((el) => getComputedStyle(el).color)];
  if (red === minor) throw new Error(`dominant and minor both ${red}`);
});

await step("a set's song: back to letters, colours off, from the Display panel - for Practice only", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.waitForLoadState("networkidle");
  await displaySetting(page, "chords", "display-notation-LETTERS");
  await page.locator('[data-chord="C"]').first().waitFor(); // D sounding, capo 2 shapes: C
  const before = await page.locator('[data-family="dominant"]').first().evaluate((el) => getComputedStyle(el).color);
  await displaySetting(page, "chords", "display-color-theme");
  await page.waitForFunction((was) => getComputedStyle(document.querySelector('[data-family="dominant"]')).color !== was, before);
  await page.waitForLoadState("networkidle");
  // Saved a moment after the last change, for Practice; the account's own settings stay as they were.
  let after;
  for (let i = 0; i < 20; i++) {
    after = await api(me, "GET", "/users/me");
    if (after.displaySettings?.PRACTICE?.chordColor === "theme") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const practice = after.displaySettings?.PRACTICE ?? {};
  if (practice.chordNotation !== "LETTERS" || practice.chordColor !== "theme") throw new Error(JSON.stringify(after.displaySettings));
  if (after.chordColors !== true) throw new Error(`the account's colours changed: ${after.chordColors}`);
});

await browser.close();
finish();
