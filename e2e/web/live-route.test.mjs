// Route (issue #322): someone whose role routes the screens opens the
// operator's view from Live's Sync menu and gets the screens and their layers
// alone - no slides, timer or messages - and hiding a layer there reaches the
// set's screens.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Route web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Route web leader");
const tech = await user("Route web tech");
const role = await api(admin, "POST", "/admin/roles", { name: `Route web ${stamp}`, canRoute: true });
await api(admin, "PUT", `/admin/users/${tech.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });
const set = await api(leader, "POST", "/setlists", { name: `Route web ${stamp}` });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { text: { title: "Notices", body: "One\n\nTwo" } });
const token = (await api(leader, "POST", `/setlists/${set.id}/share-link`)).link.token;
await call(tech, "POST", `/set-invites/${token}/join`);

const browser = await chromium.launch();
let desk;
try {
  desk = await syncDevice(leader);
  desk.send({ type: "join", setId: set.id, deviceId: `route-desk-${stamp}` });
  await desk.next((m) => m.type === "session");
  desk.send({ type: "command", id: `lead-${stamp}`, op: { kind: "lead" } });
  desk.send({ type: "command", id: `show-${stamp}`, op: { kind: "present", presenting: { itemId: items[0].id, slide: 0, black: false } } });
  await desk.next((m) => m.type === "ack" && m.id === `show-${stamp}`);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const live = await context.newPage();
  await step("Live's Sync menu offers the operator's view to someone who routes", async () => {
    page = live;
    await signIn(live, tech);
    await live.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await live.goto(`${WEB}/sets/${set.id}/live/${items[0].id}`);
    const control = live.getByTestId("sync-control").first();
    await control.click();
    await live.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await live.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await live.getByTestId("sync-operator").waitFor();
    await live.keyboard.press("Escape");
  });

  const console = await context.newPage();
  await step("the operator's view: the screens and their layers alone", async () => {
    page = console;
    await console.goto(`${WEB}/sets/${set.id}/operate`);
    const routing = console.getByTestId("operator-route-only");
    await routing.getByText("Your role routes the screens").waitFor({ timeout: 15000 });
    await routing.getByTestId("operator-layers").waitFor();
    if ((await console.getByTestId("operator-tab-slides").count()) + (await console.getByTestId("operator-not-allowed").count()) > 0) throw new Error("the slides, or a refusal, are offered to someone who only routes");
  });

  await step("hiding the media there reaches the set's screens", async () => {
    desk.drain();
    await console.getByTestId("operator-route-only").getByTestId("operator-layer-media-shown").click();
    const hidden = await desk.next((m) => m.type === "session" && !!m.stage?.layers?.hidden?.includes("media"), 5000);
    if (!hidden) throw new Error("the screens weren't told");
    await console.locator('[data-testid="operator-layer-media"][data-state="hidden"]').waitFor();
  });
} finally {
  desk?.close();
  await browser.close();
}

finish();
