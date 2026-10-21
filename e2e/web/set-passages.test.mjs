// A set's Bible passages (issue #301), in two browsers: the leader adds one
// from the set's page ("Add a passage": an imported Bible, a reference,
// previewed), changes it, reads it in the set with its Bible's copyright; a
// paired screen shows its verses when they're presented, the copyright under
// them; the operator's page steps through them - until the admin says the
// Bible may not be shown on screens.
import { chromium } from "playwright";
import { SCREEN, WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { importBible } from "../lib/bibles.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Passage web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const abbreviation = `W${stamp % 10000}`;
const bible = await importBible(admin, `Web Passages ${stamp}`, abbreviation, { canProject: true });
const leader = await user("Passage leader");
const set = await api(leader, "POST", "/setlists", { name: `Passages ${stamp}` });
const song = await api(leader, "POST", "/song-versions", { title: `Opening ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nFirst song line\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });

const browser = await chromium.launch();
let leading;
try {
  const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  for (const one of [desk, tv]) one.on("pageerror", (error) => errors.push(error.message));
  let passageId;

  await step("the leader adds a passage from the set's page: a Bible, a reference, previewed", async () => {
    page = desk;
    await signIn(desk, leader);
    await desk.goto(`${WEB}/sets/${set.id}`);
    await desk.waitForLoadState("networkidle");
    await desk.getByTestId("set-add-passage").click();
    const dialog = desk.getByTestId("set-passage-dialog");
    await dialog.getByRole("heading", { name: "Add a passage" }).waitFor();
    await dialog.locator("#set-passage-bible").selectOption({ label: `${abbreviation} - Web Passages ${stamp}` });
    await dialog.locator("#set-passage-reference").fill("Jn 3:16-17");
    await dialog.getByRole("button", { name: "Preview" }).click();
    await dialog.getByTestId("set-passage-preview").getByText("For God sent not his Son into the world to condemn the world.").waitFor();
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "detached" });
    await desk.getByTestId("set-passage-row").getByText(`John 3:16-17 (${abbreviation})`).waitFor();
    passageId = (await api(leader, "GET", `/setlists/${set.id}`)).items.find((item) => item.kind === "PASSAGE")?.id;
    if (!passageId) throw new Error("no passage item");
  });

  await step("changes it to another passage", async () => {
    await desk.getByRole("button", { name: `Edit John 3:16-17 (${abbreviation})` }).click();
    const dialog = desk.getByTestId("set-passage-dialog");
    await dialog.getByRole("heading", { name: "Edit the passage" }).waitFor();
    await dialog.locator("#set-passage-reference").fill("Psalm 23:1-2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await desk.getByTestId("set-passage-row").getByText(`Psalms 23:1-2 (${abbreviation})`).waitFor();
  });

  await step("opened in the set, it reads as its verses, its Bible's copyright beneath", async () => {
    await desk.getByTestId("set-passage-row").getByRole("link", { name: `Psalms 23:1-2 (${abbreviation})` }).click();
    await desk.waitForURL(`${WEB}/sets/${set.id}/songs/${passageId}`);
    const reading = desk.getByTestId("set-passage-reading");
    await reading.getByText("He maketh me to lie down in green pastures.").waitFor();
    await reading.getByText("Public Domain").waitFor();
  });

  await step("a screen on the set shows its verses when they're presented, the copyright under them", async () => {
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
    leading.send({ type: "update", presenting: { itemId: passageId, slide: 1, black: false } });
    await tv.locator(`[data-testid="screen-showing"][data-item="${passageId}"]`).waitFor({ timeout: 10000 });
    await tv.getByTestId("screen-lines").getByText("He maketh me to lie down in green").waitFor({ timeout: 5000 });
    await tv.getByTestId("screen-credits").getByText("Public Domain").waitFor();
  });

  await step("the operator's page: the passage in the set's list, a slide a verse, the one on the screens", async () => {
    page = desk;
    await desk.goto(`${WEB}/sets/${set.id}/operate?item=${passageId}`);
    await desk.getByTestId("operator-slides").getByTestId("operator-slide").nth(1).getByText("green pastures.").waitFor({ timeout: 10000 });
    await desk.getByText(`2. Psalms 23:1-2 (${abbreviation})`).first().waitFor();
    await desk.getByTestId("operator-tab-stage").click();
    await desk.getByTestId("operator-on-screens").getByText(`Psalms 23:1-2 (${abbreviation}) · Slide 2 of 2`).waitFor({ timeout: 10000 });
  });

  await step("its Bible no longer allowed on screens: the operator's page says so", async () => {
    await api(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { canProject: false });
    await desk.goto(`${WEB}/sets/${set.id}/operate?item=${passageId}`);
    await desk.getByTestId("operator-tab-slides").click();
    await desk.getByTestId("operator-passage-hidden").getByText("This Bible may not be shown on screens").waitFor({ timeout: 10000 });
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  leading?.close();
  await browser.close();
  await api(admin, "DELETE", `/admin/scriptures/bibles/${bible.id}`);
}
finish();
