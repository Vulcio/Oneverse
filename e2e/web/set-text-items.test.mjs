// A set's text items (issue #305), in two browsers: the leader adds one from
// the set's page ("Add text": a title, and paragraphs that are its slides),
// edits it, opens it in the set; a paired screen shows its slides when it's
// presented, its title in the set's item widget, and the operator's page
// steps through them like a song's.
import { chromium } from "playwright";
import { SCREEN, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Text leader");
const set = await api(leader, "POST", "/setlists", { name: `Texts ${stamp}` });
const song = await api(leader, "POST", "/song-versions", { title: `Opening ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nFirst song line\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });

const browser = await chromium.launch();
let leading;
try {
  const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  for (const one of [desk, tv]) one.on("pageerror", (error) => errors.push(error.message));
  let textId;

  await step("the leader adds a text from the set's page: two paragraphs, two slides", async () => {
    page = desk;
    await signIn(desk, leader);
    await desk.goto(`${WEB}/sets/${set.id}`);
    await desk.waitForLoadState("networkidle");
    await desk.getByTestId("set-add-text").click();
    const dialog = desk.getByTestId("set-text-dialog");
    await dialog.getByRole("heading", { name: "Add text" }).waitFor();
    await dialog.locator("#set-text-title").fill("Welcome");
    await dialog.locator("#set-text-body").fill("Welcome, everyone\n\nCoffee after the service");
    await dialog.getByText("2 slides").waitFor();
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "detached" });
    await desk.getByTestId("set-text-row").getByText("Welcome").waitFor();
    const { items } = await api(leader, "GET", `/setlists/${set.id}`);
    textId = items.find((item) => item.kind === "TEXT")?.id;
    if (!textId) throw new Error("no text item");
  });

  await step("edits it: a third paragraph, a new title", async () => {
    await desk.getByRole("button", { name: "Edit Welcome" }).click();
    const dialog = desk.getByTestId("set-text-dialog");
    await dialog.getByRole("heading", { name: "Edit text" }).waitFor();
    await dialog.locator("#set-text-title").fill("Notices");
    await dialog.locator("#set-text-body").fill("Welcome, everyone\n\nCoffee after the service\n\nSee you next week");
    await dialog.getByText("3 slides").waitFor();
    await dialog.getByRole("button", { name: "Save" }).click();
    await desk.getByTestId("set-text-row").getByText("Notices").waitFor();
  });

  await step("opened in the set, it reads as its slides", async () => {
    await desk.getByTestId("set-text-row").getByRole("link", { name: "Notices" }).click();
    await desk.waitForURL(`${WEB}/sets/${set.id}/songs/${textId}`);
    const slides = desk.getByTestId("set-text-slides");
    await slides.getByText("See you next week").waitFor();
    if ((await slides.locator("p").count()) !== 3) throw new Error("not three slides");
  });

  await step("a screen on the set shows the text's slides when they're presented", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Hall ${stamp}`, mode: "LYRICS", setlistId: set.id });
    await tv.locator('[data-testid="screen-display"][data-state="showing"]').waitFor({ timeout: 15000 });
    leading = await syncDevice(leader);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: textId, slide: 1, black: false } });
    await tv.locator(`[data-testid="screen-showing"][data-item="${textId}"]`).waitFor({ timeout: 10000 });
    await tv.getByTestId("screen-lines").getByText("Coffee after the service").waitFor({ timeout: 5000 });
  });

  await step("the operator's page: the text in the set's list, its slides, the one on the screens", async () => {
    page = desk;
    await desk.goto(`${WEB}/sets/${set.id}/operate`);
    await desk.getByTestId("operator-slides").getByTestId("operator-slide").nth(2).getByText("See you next week").waitFor({ timeout: 10000 });
    await desk.getByText("2. Notices").first().waitFor();
    await desk.getByTestId("operator-tab-stage").click();
    await desk.getByTestId("operator-on-screens").getByText("Notices · Slide 2 of 3").waitFor({ timeout: 10000 });
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  leading?.close();
  await browser.close();
}
finish();
