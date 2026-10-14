// The song editor's toolbar (issue #248): one bar, kept in view under the
// song's header, with the key, transpose, tempo, time and capo. Nothing in
// it moves under a finger pressing it again and again - transposing,
// undoing, a value changing - and Save is always there, disabled with
// nothing to save. On a touch screen its controls are finger-sized.
import { chromium, devices } from "playwright";
import { WEB, SP, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Toolbar editor");
const CHART = "{start_of_verse}\n[G]Amazing grace how [G7]sweet the [C]sound\nThat [G]saved a [Em]wretch like [D]me\n{end_of_verse}\n";
const song = await api(me, "POST", "/song-versions", { title: `Toolbar ${stamp}`, language: "en", artists: ["Someone"], key: "G", tempo: 72, content: CHART, contentFormat: "CHORDPRO" });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);

const toolbar = () => page.getByTestId("editor-toolbar");
const box = async (locator) => {
  const b = await locator.boundingBox();
  return b && [b.x, b.y, b.width, b.height].map(Math.round).join(",");
};
/** Where each of the toolbar's controls is, to compare before and after. */
const layout = async () => {
  const ids = ["editor-undo", "editor-redo", "editor-key", "editor-transpose-down", "editor-transpose-up", "editor-tempo", "editor-time", "editor-capo"];
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await box(page.getByTestId(id))])));
};
const same = (a, b, what) => {
  const moved = Object.keys(a).filter((id) => a[id] !== b[id]);
  if (moved.length) throw new Error(`${what}: ${moved.map((id) => `${id} ${a[id]} → ${b[id]}`).join("; ")}`);
};

await page.goto(`${WEB}/library/${song.id}?tab=editor`);
await page.locator(".ProseMirror").waitFor();

await step("one toolbar: modes, undo, the key and the song's tempo, time and capo", async () => {
  if ((await page.getByTestId("editor-key").inputValue()) !== "G") throw new Error("key");
  if ((await page.getByTestId("editor-tempo").inputValue()) !== "72") throw new Error("tempo");
  await page.getByRole("button", { name: "Save song" }).waitFor();
  if (!(await page.getByRole("button", { name: "Save song" }).isDisabled())) throw new Error("save enabled with nothing to save");
});

await step("transposing again and again: nothing in the toolbar moves", async () => {
  const before = await layout();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId("editor-transpose-up").click();
    same(before, await layout(), `transpose ${i + 1}`);
  }
  if ((await page.getByTestId("editor-key").inputValue()) !== "Db") throw new Error(await page.getByTestId("editor-key").inputValue());
  for (let i = 0; i < 6; i++) await page.getByTestId("editor-undo").click();
  same(before, await layout(), "undo");
  // Undoing a transposition brings the key back with the chords.
  if ((await page.getByTestId("editor-key").inputValue()) !== "G") throw new Error(`key after undo: ${await page.getByTestId("editor-key").inputValue()}`);
  await page.getByTestId("editor-redo").click();
  if ((await page.getByTestId("editor-key").inputValue()) !== "Ab") throw new Error(`key after redo: ${await page.getByTestId("editor-key").inputValue()}`);
  await page.getByTestId("editor-undo").click();
  await page.getByTestId("editor-transpose-down").click();
  await page.getByTestId("editor-transpose-up").click();
});

await step("tempo, time and capo from the toolbar, saved with the song", async () => {
  const before = await layout();
  await page.getByTestId("editor-tempo").fill("128");
  await page.getByTestId("editor-time").selectOption("6/8");
  await page.getByTestId("editor-capo").selectOption("2");
  same(before, await layout(), "values changed");
  const header = await box(page.getByRole("tablist"));
  await page.getByRole("button", { name: "Save song" }).click();
  await page.getByText("Saved.").waitFor();
  // The message shows over the page: the tabs under the header don't move.
  if ((await box(page.getByRole("tablist"))) !== header) throw new Error("the save message pushed the page down");
  const saved = await api(me, "GET", `/song-versions/${song.id}`);
  const defaults = saved.documentJson.defaults;
  if (defaults.tempo !== 128 || defaults.timeSignature?.numerator !== 6 || saved.capo !== 2) throw new Error(JSON.stringify({ defaults, capo: saved.capo }));
});

await step("the toolbar stays in view while scrolling", async () => {
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  const b = await page.getByTestId("editor-toolbar").boundingBox();
  if (!b || b.y < 0 || b.y > 300) throw new Error(JSON.stringify(b));
  await page.screenshot({ path: `${SP}/editor-toolbar.png` });
});

await step("Text mode: the same toolbar, its visual tools disabled rather than gone", async () => {
  await page.mouse.wheel(0, -2000);
  const before = await layout();
  await toolbar().getByRole("radio", { name: "Text" }).click();
  same(before, await layout(), "text mode");
  if (!(await page.getByTestId("editor-transpose-up").isDisabled())) throw new Error("transpose enabled in text mode");
  await toolbar().getByRole("radio", { name: "Visual" }).click();
});

await step("on a touch screen: finger-sized controls", async () => {
  const touch = await browser.newContext({ ...devices["iPad (gen 7)"] });
  const tablet = await touch.newPage();
  page = tablet;
  await signIn(tablet, me);
  await tablet.goto(`${WEB}/library/${song.id}?tab=editor`);
  await tablet.locator(".ProseMirror").waitFor();
  // The song's header stays short: its actions on one row, not a button alone on a line.
  const actions = await tablet.getByRole("button", { name: "Save song" }).boundingBox();
  const more = await tablet.getByRole("button", { name: "More actions" }).boundingBox();
  if (!actions || !more || Math.abs(actions.y - more.y) > 8) throw new Error(`header actions wrapped: ${JSON.stringify({ actions, more })}`);
  for (const id of ["editor-transpose-up", "editor-undo", "editor-key", "editor-tempo"]) {
    const b = await tablet.getByTestId(id).boundingBox();
    if (!b || b.height < 44) throw new Error(`${id}: ${JSON.stringify(b)}`);
  }
  await tablet.screenshot({ path: `${SP}/editor-toolbar-touch.png` });
  await touch.close();
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
