// Pasting a whole chart into the Editor (issue #31): a "{chorus}" line - sing
// the chorus again - adds the repeat to the song's order, as a linked copy,
// as the Song info box's import does; a key change before a section goes
// with its pass; and the paste is undone in one step.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Paste order");
const song = await api(me, "POST", "/song-versions", { title: `Pasted ${stamp}`, language: "en", artists: ["Someone"], key: "G", content: "{start_of_verse}\n\n{end_of_verse}\n", contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
const editor = () => page.getByTestId("structured-editor");
const paste = (text) =>
  editor().evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.querySelector("p[data-sv-line]")?.focus();
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
const CHART = [
  "{start_of_verse: Verse 1}",
  "[G]Amazing grace, how [C]sweet the sound",
  "{end_of_verse}",
  "",
  "{start_of_chorus}",
  "[C]My chains are [G]gone",
  "{end_of_chorus}",
  "",
  "{start_of_verse: Verse 2}",
  "[G]'Twas grace that [D]taught my heart",
  "{end_of_verse}",
  "",
  "{chorus}",
].join("\n");

await step("pasted with {chorus}: the chorus sung again, as a linked copy", async () => {
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  await page.waitForLoadState("networkidle");
  await editor().locator("p[data-sv-line]").first().click();
  await paste(CHART);
  await editor().getByTestId("linked-copy").first().waitFor();
  const blocks = await editor().locator("[data-section-type], [data-testid=linked-copy]").evaluateAll((els) => els.map((el) => el.dataset.sectionType ?? "linked").join());
  if (blocks !== "verse,chorus,verse,linked") throw new Error(blocks);
});

await step("saved: the song's order sings the chorus twice", async () => {
  await page.getByRole("button", { name: "Save song" }).first().click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  const doc = (await api(me, "GET", `/song-versions/${song.id}`)).documentJson;
  const order = doc.flow.map((item) => doc.sections.find((section) => section.id === item.sectionId)?.type).join();
  if (order !== "verse,chorus,verse,chorus") throw new Error(order);
  if (doc.sections.length !== 3) throw new Error(`${doc.sections.length} sections`);
});

await step("undone in one step", async () => {
  await editor().locator("p[data-sv-line]").last().click();
  await paste("{start_of_bridge}\n[Em]Through many dangers\n{end_of_bridge}\n\n{start_of_chorus}\n[C]Again\n{end_of_chorus}\n\n{chorus}");
  await editor().locator('[data-section-type="bridge"]').waitFor();
  const linked = await editor().getByTestId("linked-copy").count();
  if (linked !== 2) throw new Error(`${linked} linked copies`);
  await page.getByTestId("editor-undo").click();
  await editor().locator('[data-section-type="bridge"]').waitFor({ state: "detached" });
  const left = await editor().getByTestId("linked-copy").count();
  if (left !== 1) throw new Error(`${left} linked copies after the undo`);
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
