// The song order as a strip (issue #251): passes in their sections'
// colours, dragged to reorder; the pass chosen - in the strip or by
// editing its section in the chart - shows its actions in a bar that keeps
// its height chosen or not, so nothing moves under a finger.
import { chromium } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Order strip");
const CHART = "{start_of_verse}\n[G]Amazing grace\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n\n{start_of_bridge}\n[Em]Through many dangers\n{end_of_bridge}\n";
const song = await api(me, "POST", "/song-versions", { title: `Order strip ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: CHART, contentFormat: "CHORDPRO" });
const stored = async () => (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);

const strip = () => page.getByTestId("song-order");
const bar = () => page.getByTestId("song-order-pass");
const chips = () => strip().locator("li button");
const names = () => chips().evaluateAll((els) => els.map((el) => el.dataset.passSection));
const editor = () => page.getByTestId("structured-editor");
const box = async (locator) => {
  const b = await locator.boundingBox();
  return b && [b.x, b.y, b.width, b.height].map(Math.round).join(",");
};

await page.goto(`${WEB}/library/${song.id}?tab=editor`);
await editor().waitFor();

await step("the passes in their sections' colours", async () => {
  if (JSON.stringify(await names()) !== JSON.stringify(["verse", "chorus", "bridge"])) throw new Error(JSON.stringify(await names()));
  const [verse, chorus] = [await chips().nth(0).evaluate((el) => getComputedStyle(el).backgroundColor), await chips().nth(1).evaluate((el) => getComputedStyle(el).backgroundColor)];
  if (verse === chorus) throw new Error(`same colour: ${verse}`);
});

await step("the pass bar keeps its height and place, a pass chosen or not", async () => {
  const empty = await box(bar());
  const editorTop = await box(editor());
  await chips().nth(1).click();
  await bar().getByRole("button", { name: "Earlier" }).waitFor();
  if ((await box(bar())) !== empty) throw new Error(`the bar changed: ${empty} → ${await box(bar())}`);
  if ((await box(editor())) !== editorTop) throw new Error("the chart moved");
  await chips().nth(1).click();
  if ((await bar().getAttribute("data-pass")) !== null) throw new Error("not unchosen");
});

await step("editing a section in the chart chooses its pass", async () => {
  await editor().locator('[data-section-type="bridge"] p[data-sv-line]').first().click();
  await strip().locator('button[data-pass-section="bridge"][aria-pressed="true"]').waitFor();
});

await step("Earlier again and again: the button stays under the pointer", async () => {
  const earlier = bar().getByRole("button", { name: "Earlier" });
  const at = await box(earlier);
  await earlier.click();
  if ((await box(earlier)) !== at) throw new Error("Earlier moved");
  await earlier.click();
  if (JSON.stringify(await names()) !== JSON.stringify(["bridge", "verse", "chorus"])) throw new Error(JSON.stringify(await names()));
});

await step("dragged with a mouse: the pass takes the place it's dropped on", async () => {
  const from = await chips().nth(0).boundingBox();
  const to = await chips().nth(2).boundingBox();
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  if (JSON.stringify(await names()) !== JSON.stringify(["verse", "chorus", "bridge"])) throw new Error(JSON.stringify(await names()));
});

await step("Duplicate (unique copy) from the bar: a section of its own after the pass", async () => {
  await chips().nth(1).click();
  await bar().getByRole("button", { name: "Duplicate (unique copy)" }).click();
  await page.waitForTimeout(200);
  if (JSON.stringify(await names()) !== JSON.stringify(["verse", "chorus", "chorus", "bridge"])) throw new Error(JSON.stringify(await names()));
  await page.screenshot({ path: `${SP}/song-order-strip.png` });
  await page.getByRole("button", { name: "Save song" }).click();
  for (let i = 0; i < 40 && (await stored()).sections.length !== 4; i++) await page.waitForTimeout(250);
  const doc = await stored();
  if (doc.sections.length !== 4 || doc.sections[2].type !== "chorus" || doc.sections[2].id === doc.sections[1].id) throw new Error(JSON.stringify(doc.sections.map((s) => s.type)));
});

await step("the section's only pass: Take out of the song order", async () => {
  await chips().last().click();
  await bar().getByRole("button", { name: "Take out of the song order" }).click();
  await strip().getByText(/Not sung:/).waitFor();
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
