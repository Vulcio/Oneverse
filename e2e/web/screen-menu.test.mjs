// A screen's own menu (issue #276): opened on the screen itself, even while a set is presented - OK held, a
// double-click, a right-click - never by a short press or a passing click; "Choose a set" opens the set picker (a
// screen with a fixed set keeps it); "Theme" lists the built-in themes and the owner's saved ones, and the pick is kept.
import { chromium } from "playwright";
import { API, SCREEN, WEB, api, call, check, finish, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Menu admin");
const team = await api(admin, "POST", "/teams", { name: `Menu team ${stamp}` });
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const today = await api(admin, "POST", "/setlists", { name: `Today ${stamp}`, teamId: team.id, eventDate: day(0) });
const tomorrow = await api(admin, "POST", "/setlists", { name: `Tomorrow ${stamp}`, teamId: team.id, eventDate: day(1) });
const song = await api(admin, "POST", "/song-versions", { title: `Menu song ${stamp}`, language: "en", artists: ["Someone"], teamId: team.id, content: "{start_of_verse}\nA line here\nanother line\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
await api(admin, "POST", `/setlists/${today.id}/items`, { songVersionId: song.id });
const [item] = (await api(admin, "GET", `/setlists/${today.id}`)).items;
const teamTheme = await api(admin, "POST", "/screen-themes", { name: `Hall look ${stamp}`, teamId: team.id, theme: { text: { font: "elegant" } } });
// Someone else's theme: never offered, refused when asked for.
const stranger = await user("Menu stranger");
const otherTheme = await api(stranger, "POST", "/screen-themes", { name: `Not theirs ${stamp}`, theme: { text: { font: "elegant" } } });

const browser = await chromium.launch();
let leading;
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  const menu = () => tv.getByTestId("screen-menu");
  const picker = () => tv.getByTestId("screen-set-picker");
  const showing = () => tv.getByTestId("screen-showing");
  let screen;
  let token;

  await step("a screen on the day's set, presenting it", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    screen = await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `Hall ${stamp}`, mode: "LYRICS", setMode: "DAY", owner: { kind: "team", id: team.id } });
    await tv.getByTestId("screen-idle").getByText(`Today ${stamp}`).waitFor({ timeout: 15000 });
    token = await tv.evaluate(() => localStorage.getItem("songverse.screen.token"));
    leading = await syncDevice(admin);
    leading.send({ type: "join", setId: today.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    leading.send({ type: "update", presenting: { itemId: item.id, slide: 0, black: false } });
    await tv.locator(`[data-testid="screen-showing"][data-item="${item.id}"]`).waitFor({ timeout: 10000 });
  });

  await step("a short OK, a click: nothing opens over the words", async () => {
    await tv.keyboard.press("Enter");
    await showing().click({ position: { x: 300, y: 300 } });
    await tv.waitForTimeout(1200);
    if ((await menu().count()) + (await picker().count()) > 0) throw new Error("a menu opened by accident");
  });

  await step("OK held opens the menu; the key repeating picks nothing", async () => {
    await tv.keyboard.down("Enter");
    await menu().waitFor({ timeout: 3000 });
    // Still held: Playwright sends it as a repeat.
    await tv.keyboard.down("Enter");
    await tv.keyboard.up("Enter");
    await tv.waitForTimeout(300);
    if ((await menu().getAttribute("data-view")) !== "menu" || (await picker().count()) > 0) throw new Error("the held OK chose an entry");
    if ((await tv.evaluate(() => document.activeElement?.getAttribute("data-testid"))) !== "screen-menu-set") throw new Error("not focused on Choose a set");
    await tv.keyboard.press("Escape");
    await menu().waitFor({ state: "detached" });
  });

  await step("OK pressed three times opens it (issue #285); twice doesn't; the remote's Menu key does", async () => {
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("Enter");
    await tv.waitForTimeout(900);
    if ((await menu().count()) > 0) throw new Error("two presses opened the menu");
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("Enter");
    await menu().waitFor({ timeout: 3000 });
    if ((await menu().getAttribute("data-view")) !== "menu" || (await picker().count()) > 0) throw new Error("the presses chose an entry");
    await tv.keyboard.press("Escape");
    await menu().waitFor({ state: "detached" });
    await tv.keyboard.press("ContextMenu");
    await menu().waitFor({ timeout: 3000 });
    await tv.keyboard.press("Escape");
    await menu().waitFor({ state: "detached" });
  });

  await step("Choose a set, while presenting: the picker, then tomorrow's set", async () => {
    await showing().dblclick({ position: { x: 300, y: 300 } });
    await menu().waitFor();
    await tv.keyboard.press("Enter");
    await picker().waitFor();
    await picker().getByTestId("screen-pick-set").filter({ hasText: `Tomorrow ${stamp}` }).focus();
    await tv.keyboard.press("Enter");
    await tv.getByTestId("screen-idle").getByText(`Tomorrow ${stamp}`).waitFor({ timeout: 10000 });
  });

  await step("Theme: the built-in ones and the team's; the team's picked, and kept", async () => {
    await showing().dblclick({ position: { x: 300, y: 300 } });
    await menu().waitFor();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await tv.locator('[data-testid="screen-menu"][data-view="themes"]').waitFor();
    const names = await menu().getByTestId("screen-menu-theme").allInnerTexts();
    if (!names.some((one) => one.includes("Concert")) || !names.some((one) => one.includes(`Hall look ${stamp}`))) throw new Error(names.join(" | "));
    if (names.some((one) => one.includes("Not theirs"))) throw new Error("someone else's theme offered");
    // The one in use has the focus: the default look.
    if (!(await tv.evaluate(() => document.activeElement?.textContent ?? "")).includes("Classic")) throw new Error("not focused on the theme in use");
    await menu().getByTestId("screen-menu-theme").filter({ hasText: `Hall look ${stamp}` }).click();
    await menu().waitFor({ state: "detached" });
    await tv.locator(`[data-testid="screen-showing"][data-theme="${teamTheme.id}"]`).waitFor({ timeout: 10000 });
    const [kept] = (await api(admin, "GET", "/screens")).filter((one) => one.id === screen.id);
    if (kept.themeId !== teamTheme.id) throw new Error(JSON.stringify(kept));
  });

  await step("a built-in one, with the remote; Back steps out of the themes, then the menu", async () => {
    await showing().click({ button: "right", position: { x: 300, y: 300 } });
    await menu().waitFor();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await tv.locator('[data-testid="screen-menu"][data-view="themes"]').waitFor();
    await tv.keyboard.press("Escape");
    await tv.locator('[data-testid="screen-menu"][data-view="menu"]').waitFor();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await menu().getByTestId("screen-menu-theme").filter({ hasText: "Concert" }).focus();
    await tv.keyboard.press("Enter");
    await tv.locator('[data-testid="screen-showing"][data-theme="concert"]').waitFor({ timeout: 10000 });
  });

  await step("the screen's API: someone else's theme refused, both at once refused", async () => {
    const headers = { Authorization: `Screen ${token}`, "Content-Type": "application/json" };
    const post = (body) => fetch(`${API}/screens/current/theme`, { method: "POST", headers, body: JSON.stringify(body) });
    check("…someone else's theme is refused", (await post({ themeId: otherTheme.id, themeTemplate: null })).status === 404);
    check("…a saved theme and a built-in one at once are refused", (await post({ themeId: teamTheme.id, themeTemplate: "concert" })).status === 400);
  });

  await step("a fixed set: the menu can't change it, only the theme", async () => {
    await api(admin, "PATCH", `/screens/${screen.id}`, { setlistId: tomorrow.id });
    await tv.getByTestId("screen-idle").getByText(`Tomorrow ${stamp}`).waitFor({ timeout: 10000 });
    await tv.waitForTimeout(500);
    await showing().dblclick({ position: { x: 300, y: 300 } });
    await menu().waitFor();
    if (!(await menu().getByTestId("screen-menu-set").isDisabled())) throw new Error("Choose a set offered on a fixed screen");
    await menu().getByText("This screen shows the set put on it from Screens.").waitFor();
    if ((await tv.evaluate(() => document.activeElement?.getAttribute("data-testid"))) !== "screen-menu-themes") throw new Error("not focused on Theme");
    await menu().getByTestId("screen-menu-close").click();
    await menu().waitFor({ state: "detached" });
    const r = await call(admin, "GET", "/screens");
    check("…the screens still list", r.status === 200);
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
