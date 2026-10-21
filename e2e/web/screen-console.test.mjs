// Split control in the browser (issue #305): the operator's console at the
// screen app's /operate, signed in through Oneverse (the OAuth client
// "screen"), for someone whose role runs the screens - they can't edit the
// set. The singer presents from Songverse's Live while they do: both press
// Next at once and the screens move one slide, both seeing where. The
// console locks control; the singer's Live says who has it, and waits.
import { chromium } from "playwright";
import { ONEVERSE, SCREEN, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Console admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const singer = await user("Singer");
const operator = await user("Desk");
const role = await api(admin, "POST", "/admin/roles", { name: `Console ${stamp}`, canOperateScreens: true });
await api(admin, "PUT", `/admin/users/${operator.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });

const set = await api(singer, "POST", "/setlists", { name: `Split ${stamp}` });
const { items } = await api(singer, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo\n\nThree\n\nFour\n\nFive" } });
const itemId = items[0].id;
// The operator opens the set through its link: they can't edit it.
const token = (await api(singer, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(operator, "POST", `/set-invites/${token}/join`);

const browser = await chromium.launch();
let watcher;
// What the server says reaches both browsers late while this is on: two presses
// a moment apart are then both decided from the same slide, as on a slow network.
const late = { on: false };
async function context(viewport) {
  const one = await browser.newContext({ viewport });
  await one.routeWebSocket(/\/sync$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => (late.on ? setTimeout(() => ws.send(message), 600) : ws.send(message)));
  });
  return one;
}
try {
  const desk = await (await context({ width: 1280, height: 800 })).newPage();
  const tablet = await (await context({ width: 1024, height: 768 })).newPage();
  const errors = [];
  for (const one of [desk, tablet]) one.on("pageerror", (error) => errors.push(error.message));

  await step("the console at the screen app's /operate: signed in at Oneverse, back to the set list", async () => {
    page = desk;
    await desk.goto(`${SCREEN}/operate`);
    await desk.waitForURL(`${ONEVERSE}/sign-in**`);
    await desk.waitForLoadState("networkidle");
    await desk.fill("#signin-email", operator.email);
    await desk.fill("#signin-password", "hunter2pass");
    await desk.getByRole("button", { name: /Sign in/ }).first().click();
    await desk.waitForURL(`${SCREEN}/operate`);
    await desk.getByRole("heading", { name: "Run the screens" }).waitFor();
    await desk.getByTestId("operate-sets").getByText(`Split ${stamp}`).click();
    await desk.waitForURL(`${SCREEN}/operate/${set.id}**`);
    await desk.getByTestId("operator").waitFor();
  });

  await step("the singer presents from Live", async () => {
    page = tablet;
    await signIn(tablet, singer);
    await tablet.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await tablet.goto(`${WEB}/sets/${set.id}/live/${itemId}`);
    const control = tablet.getByTestId("sync-control").first();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Lead the set" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-present").click();
    await tablet.locator('[data-testid="present-panel"][data-slide="0"]').waitFor();
  });

  await step("a role that runs the screens presents without taking them: its slides can be sent", async () => {
    page = desk;
    await desk.getByTestId("operator-tab-slides").click();
    const tiles = desk.getByTestId("operator-slide");
    await tiles.first().waitFor();
    await desk.locator('[data-testid="operator-slide"][aria-current="true"]').waitFor();
    if (await tiles.nth(1).isDisabled()) throw new Error("the console can't present");
  });

  await step("Next pressed together by the singer and the operator: the screens move one slide, both see it", async () => {
    watcher = await syncDevice(singer);
    watcher.send({ type: "join", setId: set.id });
    const first = await watcher.next((m) => m.type === "session");
    const rev = first?.session?.presentingRev ?? 0;
    watcher.drain();
    late.on = true;
    await Promise.all([tablet.getByTestId("present-next").click(), desk.keyboard.press("ArrowRight")]);
    const moved = await watcher.next((m) => m.type === "session" && (m.session?.presentingRev ?? 0) > rev, 5000);
    if (moved?.session.presenting.slide !== 1) throw new Error(JSON.stringify(moved?.session.presenting));
    const again = await watcher.next((m) => m.type === "session" && (m.session?.presentingRev ?? 0) > rev + 1, 1500);
    if (again) throw new Error(`moved twice: ${JSON.stringify(again.session.presenting)}`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    late.on = false;
    page = tablet;
    await tablet.locator('[data-testid="present-panel"][data-slide="1"]').waitFor();
    page = desk;
    await desk.locator('[data-testid="operator-slide"][aria-current="true"]').getByText("Two").waitFor();
  });

  await step("the console locks control: the singer's Live says who has it and waits; given back, it presents", async () => {
    page = desk;
    await desk.getByTestId("operator-take-exclusive").click();
    await desk.locator('[data-testid="operator-control"][data-control="exclusive"]').waitFor();
    page = tablet;
    await tablet.getByTestId("present-locked").getByText("Desk", { exact: false }).waitFor();
    if (!(await tablet.getByTestId("present-next").isDisabled())) throw new Error("Live could still present");
    page = desk;
    await desk.keyboard.press("ArrowRight");
    page = tablet;
    await tablet.locator('[data-testid="present-panel"][data-slide="2"]').waitFor();
    page = desk;
    await desk.getByTestId("operator-control-release").click();
    page = tablet;
    await tablet.getByTestId("present-locked").waitFor({ state: "detached" });
    await tablet.getByTestId("present-next").click();
    page = desk;
    await desk.locator('[data-testid="operator-slide"][aria-current="true"]').getByText("Four").waitFor();
  });

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  watcher?.close();
  await browser.close();
  await call(admin, "DELETE", `/admin/roles/${role.id}`);
}
finish();
