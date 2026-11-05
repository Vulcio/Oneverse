// Where chord diagrams sit (issue #212): at the top (as before), docked at
// the bottom with the chords of the section being played - following the
// scroll, foldable, remembered, above Live's controls - beside each
// section, or hidden (a tapped chord still opens its card). Chosen in the
// Display panel, per mode.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Diagram places");
// One column, so the sections come one under the other and the chart scrolls.
await api(me, "PATCH", "/users/me", { chordDiagrams: "GUITAR", displaySettings: { PRACTICE: { columns: "1" }, LIVE: { columns: "1" } } });
const verse = Array.from({ length: 14 }, (_, i) => `[G]Line ${i + 1} of the [C]verse goes [D]on`).join("\n");
const chorus = Array.from({ length: 14 }, (_, i) => `[Em]Chorus line ${i + 1} [A]here`).join("\n");
const song = await api(me, "POST", "/song-versions", {
  title: `Diagrams ${stamp}`,
  language: "en",
  artists: ["Band"],
  key: "G",
  content: `{start_of_verse}\n${verse}\n{end_of_verse}\n{start_of_chorus}\n${chorus}\n{end_of_chorus}\n`,
  contentFormat: "CHORDPRO",
});
const chordsIn = (locator) => locator.locator("[data-chord-diagram]").evaluateAll((els) => els.map((el) => el.dataset.chordDiagram));

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await signIn(page, me);
  const panel = () => page.getByTestId("display-panel");
  const position = async (value) => {
    if (!(await panel().count())) await page.getByTestId("display-open").click();
    await panel().getByTestId(`display-diagrams-position-${value}`).click();
  };
  const open = async () => {
    await page.goto(`${WEB}/library/${song.id}`);
    await page.waitForLoadState("networkidle");
    if ((await page.evaluate(() => document.documentElement.dataset.mode)) !== "practice") {
      await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Practice" }).click();
      await page.waitForLoadState("networkidle");
    }
    await page.getByTestId("song-chart").waitFor();
  };

  await step("at the top by default: the song's chords once each", async () => {
    await open();
    const strip = page.getByTestId("chord-strip");
    await strip.waitFor();
    const chords = await chordsIn(strip);
    if (JSON.stringify(chords) !== JSON.stringify(["G", "C", "D", "Em", "A"])) throw new Error(JSON.stringify(chords));
  });

  await step("beside each section: that section's chords", async () => {
    await position("sections");
    await page.getByTestId("pass-diagrams").nth(1).waitFor();
    if (await page.getByTestId("chord-strip").count()) throw new Error("the strip is still at the top");
    const [first, second] = [await chordsIn(page.getByTestId("pass-diagrams").nth(0)), await chordsIn(page.getByTestId("pass-diagrams").nth(1))];
    if (JSON.stringify(first) !== JSON.stringify(["G", "C", "D"]) || JSON.stringify(second) !== JSON.stringify(["Em", "A"])) throw new Error(`${first} / ${second}`);
    // Beside the heading, on its right.
    const [heading, diagrams] = [await page.locator("[data-pass]").first().getByText("Verse", { exact: true }).boundingBox(), await page.getByTestId("pass-diagrams").first().boundingBox()];
    if (diagrams.x <= heading.x + heading.width) throw new Error("not beside the heading");
  });

  await step("docked at the bottom: the section being played, following the scroll", async () => {
    await position("bottom");
    await page.getByTestId("display-close").click();
    const dock = page.getByTestId("docked-diagrams");
    await dock.waitFor();
    const box = await dock.boundingBox();
    // At the bottom, over the player's dock where there is one (in Practice, What plays is chosen there: issue #390).
    const player = page.locator('[data-testid="source-dock"], [data-testid="metronome-dock"]');
    const bottom = (await player.count()) ? (await player.first().boundingBox()).y : 720;
    if (Math.round(box.y + box.height) < bottom - 2) throw new Error(`not at the bottom: ${JSON.stringify({ box, bottom })}`);
    if (JSON.stringify(await chordsIn(dock)) !== JSON.stringify(["G", "C", "D"])) throw new Error(JSON.stringify(await chordsIn(dock)));
    // The chorus up to the reading line.
    await page.locator("[data-pass]").nth(1).evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight / 4));
    await page.waitForFunction(() => document.querySelector("[data-testid=docked-diagrams] [data-chord-diagram]")?.getAttribute("data-chord-diagram") === "Em");
    if (JSON.stringify(await chordsIn(dock)) !== JSON.stringify(["Em", "A"])) throw new Error(JSON.stringify(await chordsIn(dock)));
  });

  await step("folded to its handle, and remembered", async () => {
    const dock = page.getByTestId("docked-diagrams");
    await dock.getByRole("button", { name: /This section's chords/ }).click();
    await page.locator('[data-testid="docked-diagrams"][data-folded]').waitFor();
    await page.reload();
    await page.locator('[data-testid="docked-diagrams"][data-folded]').waitFor();
    await page.getByTestId("docked-diagrams").getByRole("button", { name: /This section's chords/ }).click();
    await page.locator('[data-testid="docked-diagrams"]:not([data-folded]) [data-chord-diagram]').first().waitFor();
  });

  await step("hidden: no diagrams, but a tapped chord still opens its card", async () => {
    await position("hidden");
    await page.getByTestId("display-close").click();
    await page.getByTestId("docked-diagrams").waitFor({ state: "detached" });
    if ((await page.getByTestId("chord-strip").count()) + (await page.getByTestId("pass-diagrams").count())) throw new Error("diagrams shown");
    await page.getByTestId("song-chart").locator("[data-chord-id]").first().click();
    await page.getByTestId("chord-card").waitFor();
    await page.keyboard.press("Escape");
  });

  await step("Live keeps its own: docked there, above its controls", async () => {
    await page.goto(`${WEB}/library/${song.id}/live`);
    await page.getByTestId("live-view").waitFor();
    // Live's own setting: still at the top.
    await page.getByTestId("chord-strip").waitFor();
    await page.getByTestId("display-open").click();
    await position("bottom");
    await page.getByTestId("display-close").click();
    const [dock, footer] = [await page.getByTestId("docked-diagrams").boundingBox(), await page.getByTestId("live-controls").boundingBox()];
    if (dock.y + dock.height > footer.y + 1) throw new Error(`over the controls: ${JSON.stringify(dock)} ${JSON.stringify(footer)}`);
  });
} finally {
  await browser.close();
}
finish();
