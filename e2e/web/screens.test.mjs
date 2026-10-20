// Screens (issue #186), in two browsers: a big screen opens /screen with no
// sign-in and shows a code and a QR code; the set's leader pairs it from
// /screens, then presents the set from Live - the screen shows the lyrics two
// lines at a time with the line before and after, follows Next and Previous
// (buttons, keys) across songs, goes black, switches to the chart, and goes
// back to a new code when it's disconnected.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Presenter");
const set = await api(leader, "POST", "/setlists", { name: `Sunday ${stamp}` });
// The leader runs a team: a screen can be the team's (issue #222).
const band = await api(leader, "POST", "/teams", { name: `Screen team ${stamp}` });
const first = await api(leader, "POST", "/song-versions", {
  title: `Grace ${stamp}`,
  language: "en",
  artists: ["John Newton"],
  content: "{start_of_verse}\n[G]Amazing grace\nhow [C]sweet the sound\nthat saved a wretch\nlike me\n{end_of_verse}\n{start_of_chorus}\nI once was lost\nbut now am found\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
  ccli: "22025",
});
const second = await api(leader, "POST", "/song-versions", { title: `Second ${stamp}`, language: "en", artists: ["Band"], content: "{start_of_verse}\nOne more song\nto end the set\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: first.id });
const { items } = await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: second.id });

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const tablet = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  tablet.on("pageerror", (error) => errors.push(error.message));
  const screen = () => tv.getByTestId("screen-display");
  const lines = async () => (await tv.getByTestId("screen-lines").innerText()).replace(/\s*\n\s*/g, " / ");
  let code;

  await step("the screen, signed in nowhere, shows a code and a QR code to pair it", async () => {
    page = tv;
    await tv.goto(`${WEB}/screen`);
    await tv.getByTestId("screen-pairing").waitFor();
    code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error(code);
    const link = await tv.getByTestId("screen-qr").getAttribute("data-link");
    if (link !== `${WEB}/screens?code=${code}`) throw new Error(link);
    if (!(await tv.getByTestId("screen-qr").locator("svg").count())) throw new Error("no QR code");
  });

  await step("the leader opens the QR code's link, names the screen and picks the set: paired", async () => {
    page = tablet;
    await signIn(tablet, leader);
    await tablet.goto(`${WEB}/screens?code=${code}&setlistId=${set.id}`);
    await tablet.getByLabel("Code on the screen").waitFor();
    if ((await tablet.getByLabel("Code on the screen").inputValue()) !== `${code.slice(0, 3)}-${code.slice(3)}`) throw new Error("code not filled in");
    await tablet.getByLabel("Name").first().fill("Front TV");
    await tablet.getByTestId("screen-owner").selectOption({ label: `Team: Screen team ${stamp}` });
    await tablet.getByTestId("screen-pair-form").getByRole("button", { name: "Pair screen" }).click();
    await tablet.getByTestId("screen-paired").getByText(`Front TV is paired: it shows Sunday ${stamp}`).waitFor();
    await tablet.getByTestId("screens-list").getByTestId("screen-Front TV").waitFor();
    // Screens, under Tools (issue #267): a tile, among the team's when filtered.
    await tablet.getByTestId("nav-screens").click();
    await tablet.waitForURL(`${WEB}/screens`);
    await tablet.getByTestId("screen-add").waitFor();
    await tablet.getByTestId("screens-list").getByTestId("screen-Front TV").waitFor();
    await tablet.getByTestId("screens-filter-user").click();
    await tablet.getByTestId("screens-list").getByTestId("screen-Front TV").waitFor({ state: "detached" });
    await tablet.getByTestId(`screens-filter-team:${band.id}`).click();
    await tablet.getByTestId("screens-list").getByTestId("screen-Front TV").waitFor();
    // The other tabs: the templates, and the widgets a template can place (issue #267).
    await tablet.getByTestId("screens-tab-widgets").click();
    await tablet.waitForURL(`${WEB}/screens?tab=widgets`);
    await tablet.getByTestId("widgets-list").getByTestId("widget-countdown").getByText("Countdown").waitFor();
    await tablet.getByTestId("screens-tab-templates").click();
    await tablet.getByTestId("builtin-themes").waitFor();
    await tablet.getByTestId("screens-tab-screens").click();
    await tablet.getByTestId("screen-add").waitFor();
    page = tv;
    // The screen claims its token and waits on the set.
    await tv.locator('[data-testid="screen-display"][data-state="showing"]').waitFor({ timeout: 15000 });
    await tv.getByTestId("screen-idle").getByText(`Sunday ${stamp}`).waitFor();
  });

  await step("presenting from Live: the screen shows the first slide, the title, the next line faint and the credits", async () => {
    page = tablet;
    await tablet.evaluate(() => localStorage.setItem("songverse.mode", "live"));
    await tablet.goto(`${WEB}/sets/${set.id}/live/${items[0].id}`);
    const control = tablet.getByTestId("sync-control").first();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Turn sync on" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-menu").getByRole("menuitem", { name: "Lead the set" }).click();
    await tablet.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await control.click();
    await tablet.getByTestId("sync-menu").getByText("Front TV (screen)").waitFor();
    await tablet.getByTestId("sync-present").click();
    await tablet.getByTestId("present-panel").waitFor();
    await tablet.getByTestId("present-slide").getByText("Slide 1 of 3 · 1 screen").waitFor();
    page = tv;
    await tv.getByTestId("screen-lyrics").waitFor({ timeout: 10000 });
    if ((await lines()) !== "Amazing grace / how sweet the sound") throw new Error(await lines());
    if ((await tv.getByTestId("screen-after").innerText()) !== "that saved a wretch") throw new Error("not the next line");
    await tv.getByText(`Grace ${stamp}`, { exact: false }).first().waitFor();
    await tv.getByTestId("screen-credits").getByText("CCLI song 22025", { exact: false }).waitFor();
  });

  await step("Next, then the down arrow (a pedal's key): the screen follows, the line before faint", async () => {
    page = tablet;
    await tablet.getByTestId("present-next").click();
    page = tv;
    await tv.locator('[data-testid="screen-showing"][data-slide="1"]').waitFor();
    if ((await lines()) !== "that saved a wretch / like me") throw new Error(await lines());
    if ((await tv.getByTestId("screen-before").innerText()) !== "how sweet the sound") throw new Error("not the line before");
    page = tablet;
    await tablet.keyboard.press("ArrowDown");
    page = tv;
    await tv.locator('[data-testid="screen-showing"][data-slide="2"]').waitFor();
    if ((await lines()) !== "I once was lost / but now am found") throw new Error(await lines());
  });

  await step("past the song's last slide: the next song; back past its first: the last slide of the one before", async () => {
    page = tablet;
    await tablet.keyboard.press("PageDown");
    await tablet.waitForURL(`**/live/${items[1].id}`);
    page = tv;
    await tv.locator(`[data-testid="screen-showing"][data-item="${items[1].id}"][data-slide="0"]`).waitFor();
    if ((await lines()) !== "One more song / to end the set") throw new Error(await lines());
    page = tablet;
    await tablet.keyboard.press("ArrowUp");
    await tablet.waitForURL(`**/live/${items[0].id}`);
    page = tv;
    await tv.locator(`[data-testid="screen-showing"][data-item="${items[0].id}"][data-slide="2"]`).waitFor();
  });

  await step("a section picked on the tablet, then Black: the screen shows nothing", async () => {
    page = tablet;
    await tablet.getByTestId("present-section").first().click();
    page = tv;
    await tv.locator('[data-testid="screen-showing"][data-slide="0"]').waitFor();
    page = tablet;
    await tablet.getByTestId("present-black").click();
    page = tv;
    await tv.locator('[data-testid="screen-showing"][data-black="true"]').waitFor();
    // Faded to black, then nothing left to read (issue #194).
    await tv.getByTestId("screen-lyrics").waitFor({ state: "detached", timeout: 3000 }).catch(() => {
      throw new Error("lyrics while black");
    });
    page = tablet;
    await tablet.getByTestId("present-black").click();
    page = tv;
    await tv.getByTestId("screen-lyrics").waitFor();
  });

  await step("switched to the chart from the phone: the band's chart, the pass being sung marked", async () => {
    const [mine] = await api(leader, "GET", `/screens?setlistId=${set.id}`);
    await api(leader, "PATCH", `/screens/${mine.id}`, { mode: "CHART" });
    page = tv;
    await tv.locator('[data-testid="screen-showing"][data-mode="CHART"]').waitFor({ timeout: 10000 });
    await tv.getByTestId("screen-chart").locator("[data-pass][data-current]").getByText("Amazing grace", { exact: false }).waitFor();
    await tv.getByTestId("screen-chart").getByText("G", { exact: true }).first().waitFor();
  });

  await step("disconnected from the phone: the screen goes back to a new code", async () => {
    page = tablet;
    await tablet.goto(`${WEB}/screens?setlistId=${set.id}`);
    const row = tablet.getByTestId("screens-list").getByTestId("screen-Front TV");
    // Connected: its tile says so (issue #267).
    if ((await row.getAttribute("data-online")) !== "true") throw new Error(`not shown as connected: ${await row.getByTestId("screen-status").innerText()}`);
    // Disconnect, on the tile itself (issue #288).
    await row.getByRole("button", { name: "Disconnect" }).click();
    await row.getByRole("button", { name: "Disconnect it" }).click();
    await row.waitFor({ state: "detached" });
    page = tv;
    await tv.getByTestId("screen-pairing").waitFor({ timeout: 10000 });
    const again = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    if (again === code) throw new Error("the same code");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join("\n"));
  });
} finally {
  await browser.close();
}
finish();
