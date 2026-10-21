// Effects (issue #281): made in their own editor - reactions of the background to the words, an animation of the
// words - and used by a template; on a screen, a slide coming sets the background off (its levels written as CSS
// variables, frame by frame) and the words move; a screen with effects off shows the same template without them.
import { chromium } from "playwright";
import { SCREEN, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Effects admin");
const set = await api(admin, "POST", "/setlists", { name: `Effects ${stamp}` });
const song = await api(admin, "POST", "/song-versions", {
  title: `Effects song ${stamp}`,
  language: "en",
  artists: ["Someone"],
  content: "{start_of_verse}\nFirst line here\nsecond line\nthird line here\nfourth line\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const [item] = (await api(admin, "GET", `/setlists/${set.id}`)).items;

const browser = await chromium.launch();
let leading;
try {
  const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  for (const one of [desk, tv]) one.on("pageerror", (error) => errors.push(error.message));
  let effects;
  let screen;

  await step("effects made in their own editor: a pulse on each slide, the words breathing", async () => {
    page = desk;
    await signIn(desk, admin);
    await desk.goto(`${WEB}/screens?tab=templates`);
    await desk.getByTestId("templates-view-effects").click();
    await desk.getByTestId("new-part-effects").click();
    const editor = desk.getByTestId("part-editor");
    // Previewed over a moving background.
    await editor.locator('[data-testid="theme-preview"] [data-background="aurora"]').waitFor();
    const reactions = editor.getByTestId("theme-reaction");
    const before = await reactions.count();
    await editor.getByTestId("theme-add-reaction").click();
    await reactions.nth(before).getByTestId("theme-reaction-on").selectOption("slide");
    await reactions.nth(before).getByTestId("theme-reaction-target").selectOption("pulse");
    await editor.getByTestId("theme-text-animation").locator('[data-value="breathe"]').click();
    await editor.locator('[data-testid="theme-preview"] [data-testid="screen-stage"][data-text-animation="breathe"][data-effects]').waitFor();
    await editor.locator("#theme-name").fill(`Glue ${stamp}`);
    await editor.getByTestId("theme-save").click();
    await editor.waitFor({ state: "detached" });
    await desk.getByTestId(`saved-part-Glue ${stamp}`).waitFor();
    effects = (await api(admin, "GET", "/screen-parts?kind=effects")).find((one) => one.name === `Glue ${stamp}`);
    if (!effects?.document.reactions.some((one) => one.on === "slide" && one.target === "pulse") || effects.document.text.animation !== "breathe") throw new Error(JSON.stringify(effects));
  });

  await step("a template with them, on a screen: a slide coming pulses the background, the words breathe", async () => {
    const template = await api(admin, "POST", "/screen-themes", { name: `Glued ${stamp}`, content: { builtIn: "classic" }, background: { builtIn: "concert" }, effects: { id: effects.id }, template: { tags: ["audience", "lyrics"] } });
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    screen = await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `Glue TV ${stamp}`, setlistId: set.id, themeId: template.id });
    leading = await syncDevice(admin);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
    await tv.getByTestId("screen-lines").getByText("First line here").waitFor({ timeout: 15000 });
    await tv.locator('[data-testid="screen-stage"][data-effects][data-text-animation="breathe"]').waitFor();
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 1, black: false } });
    await tv.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="screen-stage"]')).getPropertyValue("--react-pulse") || 0) > 0.2, null, { timeout: 5000 });
    // And it fades again.
    await tv.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="screen-stage"]')).getPropertyValue("--react-pulse") || 0) < 0.05, null, { timeout: 5000 });
  });

  await step("effects off on the screen (its settings): the same template, nothing reacting", async () => {
    page = desk;
    await desk.goto(`${WEB}/screens`);
    await desk.getByTestId(`screen-Glue TV ${stamp}`).getByTestId("screen-settings").click();
    const dialog = desk.getByTestId("screen-dialog");
    await dialog.getByTestId("screen-effects").click();
    await dialog.locator('[data-testid="screen-effects"]:not(:checked)').waitFor({ timeout: 5000 });
    await dialog.getByTestId("screen-dialog-done").click();
    page = tv;
    await tv.locator('[data-testid="screen-stage"][data-text-animation="none"]:not([data-effects])').waitFor({ timeout: 10000 });
    const [kept] = (await api(admin, "GET", "/screens")).filter((one) => one.id === screen.id);
    if (kept.effects !== false) throw new Error(JSON.stringify(kept));
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  leading?.close();
  await browser.close();
  for (const one of await api(admin, "GET", "/screens")) await api(admin, "DELETE", `/screens/${one.id}`);
}
finish();
