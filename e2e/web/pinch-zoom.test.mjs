// Pinch to zoom (issue #508): in Practice and in Live, a trackpad's pinch (Ctrl and the wheel) or
// two fingers step the chart's size through the Display sizes, words and chords together, saved
// like A- and A+; the browser's own page zoom stays off the chart.
import { chromium, devices } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Pinch zoomer");
const verses = Array.from({ length: 30 }, (_, i) => `[G]Line ${i + 1} of the [C]song and [D]on it goes`).join("\n");
const song = await api(me, "POST", "/song-versions", { title: `Pinch ${stamp}`, language: "en", artists: ["Band"], key: "G", tempo: 100, content: `{start_of_verse}\n${verses}\n{end_of_verse}\n`, contentFormat: "CHORDPRO" });
// Live's chords set apart from the words: they move by the same step.
await api(me, "PATCH", "/users/me", { displaySettings: { LIVE: { textSize: 1.5, chordSize: 2 } } });

const saved = async (check) => {
  for (let i = 0; i < 30; i++) {
    const found = (await api(me, "GET", "/users/me")).displaySettings ?? {};
    if (check(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`not saved: ${JSON.stringify((await api(me, "GET", "/users/me")).displaySettings)}`);
};

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
const chart = () => page.getByTestId("practice-chart");
const zoomOf = (locator) => locator.evaluate((el) => Number(el.style.zoom));
const pinchOut = async (box, deltaY) => {
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
};

await step("Practice: a trackpad's pinch makes the chart a step bigger, the size shown, saved", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await chart().waitFor();
  if ((await zoomOf(chart())) !== 1) throw new Error(`starts at ${await zoomOf(chart())}`);
  await pinchOut(await chart().boundingBox(), -100);
  await page.getByTestId("pinch-zoom-size").filter({ hasText: "125%" }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="practice-chart"]')?.style.zoom === "1.25");
  await saved((found) => found.PRACTICE?.textSize === 1.25);
  // The page itself isn't zoomed by the browser.
  if ((await page.evaluate(() => window.visualViewport?.scale ?? 1)) !== 1) throw new Error("the page zoomed");
});

await step("pinched in, a step smaller; the size goes away after", async () => {
  await pinchOut(await chart().boundingBox(), 100);
  await page.waitForFunction(() => document.querySelector('[data-testid="practice-chart"]')?.style.zoom === "1");
  await page.getByTestId("pinch-zoom-size").waitFor({ state: "detached", timeout: 3000 });
  await saved((found) => found.PRACTICE?.textSize === 1);
});

await step("the line under the pointer stays under it", async () => {
  await page.evaluate(() => window.scrollTo(0, 400));
  const line = page.locator("[data-line-id]", { hasText: "Line 12 of" }).first();
  const before = await line.boundingBox();
  await page.mouse.move(before.x + 20, before.y + before.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector('[data-testid="practice-chart"]')?.style.zoom === "1.25");
  await page.waitForTimeout(200);
  const after = await line.boundingBox();
  const moved = Math.abs(after.y + after.height / 2 - (before.y + before.height / 2));
  if (moved > before.height) throw new Error(`the line moved ${moved}px`);
});

await step("Live: A+ moves chords set apart from the words by the same step", async () => {
  await page.goto(`${WEB}/library/${song.id}/live`);
  await page.getByTestId("live-view").waitFor();
  await page.getByRole("button", { name: "Bigger text" }).first().click();
  await saved((found) => found.LIVE?.textSize === 1.75 && found.LIVE?.chordSize === 2.5);
});

const phone = await browser.newContext({ ...devices["iPhone 13"], storageState: await page.context().storageState() });
page = await phone.newPage();

await step("Live on a phone: two fingers spread, words and chords a step bigger together, the page itself not zoomed", async () => {
  await page.goto(`${WEB}/library/${song.id}/live`);
  await page.getByTestId("live-view").waitFor();
  const area = await page.getByTestId("live-scroll").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = area.x + area.width / 2;
  const y = area.y + area.height / 2;
  const touch = (type, gap) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: x - gap / 2, y, id: 1 }, { x: x + gap / 2, y, id: 2 }] });
  await touch("touchStart", 100);
  for (const gap of [110, 120, 130]) await touch("touchMove", gap);
  await touch("touchEnd", 0);
  await page.getByTestId("pinch-zoom-size").filter({ hasText: "200%" }).waitFor();
  await saved((found) => found.LIVE?.textSize === 2 && found.LIVE?.chordSize === 3);
  if ((await page.evaluate(() => window.visualViewport?.scale ?? 1)) !== 1) throw new Error("the page zoomed");
});

await phone.close();
await browser.close();
finish();
