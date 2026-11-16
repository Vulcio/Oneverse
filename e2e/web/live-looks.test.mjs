// How the chart looks (issue #226): named looks in Display > Look - Plain,
// Blocks (Live's default), Rail, High contrast - and each player's changes to
// them: the sections' colours, the current section (marked, the others dimmed),
// a chorus sung again as its first line. The section with the line being sung
// is the current one; the metronome's beat shows through the sections.
import { chromium } from "playwright";
import { SP, WEB, api, check, displaySetting, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Stage reader");
const chorus = "{start_of_chorus}\n[D]Light over the [A]water, [Bm]shining on the [G]sea\n[G]Here in Your [A]arms I'm [D]safe\n{end_of_chorus}\n";
const song = await api(me, "POST", "/song-versions", {
  title: `Looks ${stamp}`,
  language: "en",
  artists: ["Someone"],
  key: "D",
  tempo: 72,
  content:
    "{start_of_verse}\n[D]Morning breaks on the [A]quiet shore\n[Bm]every shadow [G]runs before\n{end_of_verse}\n" +
    chorus +
    "{start_of_verse}\n[D]When the night was [A]all I knew\n[Bm]You were there, You [G]carried through\n{end_of_verse}\n" +
    chorus,
  contentFormat: "CHORDPRO",
});
const document = JSON.parse(sql(`select "documentJson" from "SongVersion" where id='${song.id}'`));
const chorusSection = document.sections.find((section) => section.type === "chorus");
const chorusPasses = document.flow.filter((item) => item.sectionId === chorusSection.id);
check("the chorus is one section sung twice", chorusPasses.length === 2, JSON.stringify(document.flow));
const set = await api(me, "POST", "/setlists", { name: `Stage ${stamp}` });
const [item] = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items;
// A note on the second chorus: it keeps that chorus written out.
await api(me, "POST", "/notes", { songVersionId: song.id, content: "Keys and pad only", place: "ME", anchor: { kind: "section", sectionId: document.sections[0].id, passId: document.flow[0].id } });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
const chart = () => page.getByTestId("song-chart");
const pass = (id) => chart().locator(`[data-pass="${id}"]`);
const style = (locator, property) => locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
// A computed style once its transition has settled.
const settled = async (locator, property, ok, what) => {
  let last;
  for (let i = 0; i < 25; i++) {
    last = await style(locator, property);
    if (ok(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${what}: ${property} ${last}`);
};
const marked = (value) => !!value && value !== "none";
const saved = async (check) => {
  for (let i = 0; i < 30; i++) {
    const found = (await api(me, "GET", "/users/me")).displaySettings ?? {};
    if (check(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`not saved: ${JSON.stringify((await api(me, "GET", "/users/me")).displaySettings)}`);
};

await step("Live: Blocks by default, each section a card in its colour, the chorus heavier", async () => {
  await page.goto(`${WEB}/sets/${set.id}/live/${item.id}`);
  await chart().waitFor();
  if ((await chart().getAttribute("data-look")) !== "blocks") throw new Error(`look ${await chart().getAttribute("data-look")}`);
  if ((await pass(document.flow[0].id).getAttribute("data-section-color")) !== "verse") throw new Error("no verse colour");
  // Live's text is zoomed: the chorus's edge twice the verse's.
  const verseBorder = parseFloat(await style(pass(document.flow[0].id), "border-top-width"));
  const chorusBorder = parseFloat(await style(pass(chorusPasses[0].id), "border-top-width"));
  if (!(chorusBorder > verseBorder)) throw new Error(`borders ${verseBorder} ${chorusBorder}`);
  // See-through: the metronome's beat behind the page shows through the cards.
  const background = await style(pass(document.flow[0].id), "background-color");
  if (!/(oklab|oklch|rgba?|color)\(.*\/\s*0\.\d|rgba\(.*, 0\.\d+\)/.test(background)) throw new Error(`an opaque card: ${background}`);
  // The note is on the chart as in every look.
  await chart().getByText("Keys and pad only").waitFor();
  await page.screenshot({ path: `${SP}/live-looks-blocks.png` });
});

await step("The metronome as the background: its beat shows through the sections", async () => {
  await displaySetting(page, "metronome", "display-metronomeDisplay-background");
  await page.getByTestId("metronome-song").first().click();
  await page.locator('[data-testid="beat-columns"] [data-lit]').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SP}/live-looks-metronome.png` });
  await page.getByTestId("metronome-song").first().click();
  await page.getByTestId("beat-columns").waitFor({ state: "detached" });
});

await step("The current section: the one picked in the sections bar, glowing in its colour", async () => {
  await page.getByTestId("live-structure").getByRole("button").nth(1).click();
  await chart().locator(`[data-pass="${chorusPasses[0].id}"][data-current]`).waitFor();
  await settled(pass(chorusPasses[0].id), "box-shadow", marked, "the current chorus isn't marked");
  await settled(pass(document.flow[0].id), "box-shadow", (value) => !marked(value), "the verse is marked too");
});

await step("The line being sung wins: its section is the current one", async () => {
  // As the sung line marks it while the music plays (issue #365).
  await pass(document.flow[2].id).locator("[data-line]").first().evaluate((el) => el.setAttribute("data-sung", ""));
  await settled(pass(document.flow[2].id), "box-shadow", marked, "the sung line's section isn't marked");
  await settled(pass(chorusPasses[0].id), "box-shadow", (value) => !marked(value), "the picked chorus is still marked");
  await pass(document.flow[2].id).locator("[data-line]").first().evaluate((el) => el.removeAttribute("data-sung"));
});

await step("Display > Look: Rail, saved for Live", async () => {
  await displaySetting(page, "look", "display-look-rail");
  await page.locator('[data-testid="song-chart"][data-look="rail"]').waitFor();
  const rail = parseFloat(await style(pass(chorusPasses[0].id), "border-left-width"));
  const verseRail = parseFloat(await style(pass(document.flow[0].id), "border-left-width"));
  if (rail < verseRail * 2) throw new Error(`the chorus's bar is ${rail}, the verse's ${verseRail}`);
  await saved((found) => found.LIVE?.chartLook === "rail");
  await page.screenshot({ path: `${SP}/live-looks-rail.png` });
});

await step("Changes to a look: the chorus's colour only, the others dimmed", async () => {
  await displaySetting(page, "look", "display-lookSectionColors-chorus");
  await chart().locator(`[data-pass="${document.flow[0].id}"][data-section-color="plain"]`).waitFor();
  if ((await pass(chorusPasses[0].id).getAttribute("data-section-color")) !== "chorus") throw new Error("the chorus lost its colour");
  await displaySetting(page, "look", "display-lookCurrent-dim");
  await page.locator('[data-testid="song-chart"][data-look-current="dim"]').waitFor();
  // The current one is where the page is scrolled to (the first section, at the top).
  const current = chart().locator("[data-pass][data-current]");
  await settled(current, "opacity", (value) => value === "1", "the current one is dimmed");
  await settled(chart().locator("[data-pass]:not([data-current])").first(), "opacity", (value) => value === "0.5", "the others aren't dimmed");
  await saved((found) => found.LIVE?.lookSectionColors === "chorus" && found.LIVE?.lookCurrent === "dim");
});

await step("A chorus sung again: its first line, the rest kept hidden for the sung line", async () => {
  await displaySetting(page, "look", "display-lookChorusAgain-first-line");
  const again = pass(chorusPasses[1].id);
  await again.locator("[data-pass-reminder]").getByText("Light over the water, shining on the sea …").waitFor();
  if (await again.locator("[data-line]").first().isVisible()) throw new Error("its lines still show");
  if ((await pass(chorusPasses[0].id).locator("[data-pass-reminder]").count()) !== 0) throw new Error("the first chorus is shortened");
});

await step("High contrast: heavy words, yellow chords", async () => {
  await displaySetting(page, "look", "display-look-contrast");
  await page.locator('[data-testid="song-chart"][data-look="contrast"]').waitFor();
  const chord = await style(chart().locator("[data-chord-ref]").first(), "color");
  if (chord !== "rgb(255, 216, 74)") throw new Error(`chords in ${chord}`);
  await page.screenshot({ path: `${SP}/live-looks-contrast.png` });
});

await step("A phone: nothing wider than the screen", async () => {
  await displaySetting(page, "look", "display-look-blocks");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-testid="song-chart"][data-look="blocks"]').waitFor();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide > 390) throw new Error(`the page is ${wide}px wide`);
  await page.screenshot({ path: `${SP}/live-looks-phone.png` });
});

await step("Practice keeps the plain chart unless changed there", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await chart().waitFor();
  if ((await chart().getAttribute("data-look")) !== "plain") throw new Error(`look ${await chart().getAttribute("data-look")}`);
  if ((await pass(document.flow[0].id).getAttribute("data-section-color")) !== null) throw new Error("plain has colours");
});

await browser.close();
finish();
