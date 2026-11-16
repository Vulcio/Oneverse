// Rows of chords (issue #230): a second row under or over the main chords,
// beside them as a superscript or side by side, the gap between them
// adjustable; off unless turned on, and off it keeps its settings. Each
// row's own names (a notation), chord (as it sounds, or the capo's shape),
// colour, font and weight: the same options for both. Sharps and flats as
// ♯ and ♭. Kept per mode; a row that only repeats the other isn't shown;
// lyrics only hides both; a tapped chord's card names it as the rows do.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user, chooseMode } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Chord rows");
const chart = "{start_of_verse}\n[A]Amazing [D]grace how [E7]sweet the [F#m]sound\n{end_of_verse}\n";
const capoSong = await api(me, "POST", "/song-versions", { title: `Rows capo ${stamp}`, language: "en", artists: ["Band"], key: "A", capo: 2, content: chart, contentFormat: "CHORDPRO" });
const plainSong = await api(me, "POST", "/song-versions", { title: `Rows plain ${stamp}`, language: "en", artists: ["Band"], key: "A", content: chart, contentFormat: "CHORDPRO" });
const saved = async (check) => {
  for (let i = 0; i < 30; i++) {
    const found = (await api(me, "GET", "/users/me")).displaySettings ?? {};
    if (check(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`not saved: ${JSON.stringify((await api(me, "GET", "/users/me")).displaySettings)}`);
};

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await signIn(page, me);
  const panel = () => page.getByTestId("display-panel");
  const songChart = () => page.getByTestId("song-chart");
  const second = () => songChart().locator("[data-chord-second]");
  const open = async (song) => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.waitForLoadState("networkidle");
    if ((await page.evaluate(() => document.documentElement.dataset.mode)) !== "practice") {
      await chooseMode(page, "Practice");
      await page.waitForLoadState("networkidle");
    }
    await songChart().waitFor();
  };

  await step("off by default: one row of chords", async () => {
    await open(capoSong);
    if (await second().count()) throw new Error("a second row by default");
    await page.getByTestId("display-open").click();
    await panel().getByTestId("display-second-row").waitFor();
  });

  await step("turned on: Roman numerals; the capo's shapes instead, under the chords as they sound, in italics", async () => {
    await panel().getByTestId("display-second-on").click();
    await second().first().getByText("I", { exact: true }).waitFor();
    await panel().getByTestId("display-second-notation-LETTERS").click();
    await panel().getByTestId("display-second-capo-FINGERED").click();
    await second().first().getByText("G", { exact: true }).waitFor();
    const [main, shape, lyric] = await Promise.all([
      songChart().locator("[data-chord]").first().evaluate((el) => ({ text: el.textContent, y: el.getBoundingClientRect().top, italic: getComputedStyle(el).fontStyle })),
      second().first().evaluate((el) => ({ text: el.textContent, y: el.getBoundingClientRect().top, italic: getComputedStyle(el).fontStyle })),
      songChart().locator("[data-line]").first().getByText("Amazing").evaluate((el) => el.getBoundingClientRect().top),
    ]);
    if (main.text !== "A" || shape.text !== "G") throw new Error(`${main.text} / ${shape.text}`);
    if (!(main.y < shape.y && shape.y < lyric)) throw new Error(`not under the chord: ${main.y} ${shape.y} ${lyric}`);
    if (shape.italic !== "italic" || main.italic === "italic") throw new Error(`italics: ${main.italic} ${shape.italic}`);
    await saved((found) => found.PRACTICE?.secondRow?.source === "FINGERED" && found.PRACTICE.secondRow.names === "LETTERS");
  });

  await step("beside each chord, as a superscript", async () => {
    await panel().getByTestId("display-second-position-beside").click();
    await songChart().locator("sup [data-chord-second]").first().waitFor();
  });

  await step("the second row's own names, colour and size", async () => {
    await panel().getByTestId("display-second-notation-ROMAN").click();
    await songChart().locator("sup [data-chord-second]").first().getByText("I", { exact: true }).waitFor();
    await panel().getByTestId("display-second-color-custom").click();
    await panel().getByTestId("display-second-color-pick").fill("#00aa00");
    await page.waitForFunction(() => {
      const element = document.querySelector("[data-chord-second] [style*='color']");
      return !!element && getComputedStyle(element).color === "rgb(0, 170, 0)";
    });
    const before = await second().first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await panel().getByTestId("display-second-size-smaller").click();
    await panel().getByTestId("display-second-size").getByText("70%").waitFor();
    await page.waitForFunction((was) => parseFloat(getComputedStyle(document.querySelector("[data-chord-second]")).fontSize) < was, before);
  });

  await step("side by side, after or before each chord, the gap between them adjustable", async () => {
    await panel().getByTestId("display-second-position-right").click();
    const inside = songChart().locator("[data-chord] [data-chord-second]").first();
    await inside.waitFor();
    const apart = async () =>
      inside.evaluate((el) => {
        const main = el.parentElement.querySelector(":scope > span:not([data-chord-second])").getBoundingClientRect();
        const own = el.getBoundingClientRect();
        return { gap: own.left - main.right, after: own.left >= main.right - 1, line: Math.abs(own.bottom - main.bottom) < 6 };
      });
    const before = await apart();
    if (!before.after || !before.line) throw new Error(`not after the chord on its line: ${JSON.stringify(before)}`);
    await panel().getByTestId("display-second-gap-bigger").click();
    await panel().getByTestId("display-second-gap-bigger").click();
    await page.waitForTimeout(200);
    const wider = await apart();
    if (!(wider.gap > before.gap + 1)) throw new Error(`the gap didn't grow: ${before.gap} -> ${wider.gap}`);
    await panel().getByTestId("display-second-position-left").click();
    await page.waitForFunction(() => {
      const second = document.querySelector("[data-chord] [data-chord-second]");
      const main = second?.parentElement.querySelector(":scope > span:not([data-chord-second])");
      return second && main && second.getBoundingClientRect().right <= main.getBoundingClientRect().left + 1;
    });
    await panel().getByTestId("display-second-position-below").click();
  });

  await step("sharps and flats as their symbols", async () => {
    await songChart().locator("[data-chord]").filter({ hasText: "F♯m" }).first().waitFor();
    if ((await songChart().textContent()).includes("F#m")) throw new Error("a # left");
  });

  await step("turned off and on again: as it was set", async () => {
    await panel().getByTestId("display-second-off").click();
    await second().first().waitFor({ state: "detached" });
    await saved((found) => found.PRACTICE?.secondRow?.on === false && found.PRACTICE.secondRow.source === "FINGERED");
    await panel().getByTestId("display-second-on").click();
    // Its Roman numerals, 70%, green - kept.
    await second().first().getByText("I", { exact: true }).waitFor();
    await panel().getByTestId("display-second-size").getByText("70%").waitFor();
  });

  await step("the main row has the same options: its font and weight", async () => {
    await panel().getByTestId("display-chord-font-sans").click();
    await panel().getByTestId("display-weight-normal").click();
    await page.waitForFunction(() => {
      const style = getComputedStyle(document.querySelector("[data-testid=song-chart] [data-chord]"));
      return !style.fontFamily.toLowerCase().includes("mono") && Number(style.fontWeight) < 600;
    });
  });

  await step("a tapped chord's card names it as the rows do: the shape to play, and the chord as it sounds", async () => {
    await panel().getByTestId("display-second-notation-LETTERS").click();
    await second().first().getByText("G").waitFor();
    // The card's instrument: the player's diagrams.
    await panel().getByTestId("display-diagrams-GUITAR").click();
    await page.getByTestId("display-close").click();
    await songChart().locator("[data-chord-id]").first().click();
    // The card draws the shape played (G); the main row's A is named under it.
    await page.locator('[data-testid="chord-card"][data-chord="G"]').waitFor();
    await page.getByTestId("chord-card-also").getByText("A", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
  });

  await step("lyrics only hides both rows", async () => {
    await page.getByTestId("display-open").click();
    await panel().getByTestId("display-chords-hidden").click();
    await page.locator('[data-testid="song-chart"][data-hide-chords]').waitFor();
    if ((await second().count()) + (await songChart().locator("[data-chord]").count()) !== 0) throw new Error("chords still shown");
    await panel().getByTestId("display-chords-shown").click();
    await second().first().waitFor();
  });

  await step("a song without a capo: the shapes would only repeat the chords, so no second row", async () => {
    await open(plainSong);
    await songChart().locator("[data-chord]").first().waitFor();
    if (await second().count()) throw new Error("a second row repeating the first");
  });

  await step("kept for Practice only: Live has one row", async () => {
    await saved((found) => found.PRACTICE?.secondRow?.names === "LETTERS" && found.PRACTICE.chordFont === "sans" && !found.LIVE?.secondRow);
    await page.goto(`${WEB}/library/${capoSong.id}/live`);
    await page.getByTestId("live-view").waitFor();
    await songChart().locator("[data-chord]").first().waitFor();
    if (await second().count()) throw new Error("Live has the second row");
  });

  await step("turned off", async () => {
    await open(capoSong);
    await second().first().waitFor();
    await page.getByTestId("display-open").click();
    await panel().getByTestId("display-second-off").click();
    await second().first().waitFor({ state: "detached" });
    await saved((found) => found.PRACTICE?.secondRow?.on === false);
  });
} finally {
  await browser.close();
}
finish();
