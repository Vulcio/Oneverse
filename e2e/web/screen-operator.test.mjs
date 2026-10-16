// The media operator (issue #269): a set's timer and message for its screens, run over /sync by anyone who can
// edit the set - leading or not - and refused to anyone else; a set item's own timer, started when Live comes to it;
// the operator's page: a countdown started, a minute more, a message sent and cleared, all on a stage display.
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { syncDevice } from "../lib/sync-device.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Stage leader");
const operator = await user("Stage operator");
const member = await user("Stage member");
const team = await api(leader, "POST", "/teams", { name: `Stage team ${stamp}` });
for (const [who, role] of [
  [operator, "ADMIN"],
  [member, "MEMBER"],
]) {
  const link = await api(leader, "POST", `/teams/${team.id}/invite-links`, { role });
  await api(who, "POST", `/teams/join/${link.token}`);
}
const set = await api(leader, "POST", "/setlists", { name: `Stage ${stamp}`, teamId: team.id });
const songs = [];
for (const title of ["Opening", "Sermon song"]) {
  const song = await api(leader, "POST", "/song-versions", { title: `${title} ${stamp}`, language: "en", artists: ["Someone"], teamId: team.id, content: "{start_of_verse}\nA line here\nanother line\n{end_of_verse}\n", contentFormat: "CHORDPRO" });
  songs.push(song);
  await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
}
const items = (await api(leader, "GET", `/setlists/${set.id}`)).items;
// Notes on the first song (issue #275): one by someone holding the team's "Media" position, one by someone who doesn't.
const media = await api(leader, "POST", `/teams/${team.id}/positions`, { name: `Media ${stamp}` });
await api(leader, "PUT", `/teams/${team.id}/members/${member.id}/positions`, { positionIds: [media.id] });
await api(member, "POST", "/notes", { songVersionId: songs[0].id, content: `Lights down ${stamp}`, place: "TEAM", teamId: team.id });
await api(operator, "POST", "/notes", { songVersionId: songs[0].id, content: `Capo 2 ${stamp}`, place: "TEAM", teamId: team.id });

// --- a set item's own timer
let r = await call(leader, "PATCH", `/setlists/${set.id}/items/${items[1].id}`, { timer: { kind: "countdown", duration: 120 } });
check("a set item gets a timer of its own", r.status === 200 && r.body.items[1].timer?.duration === 120, JSON.stringify(r.body.items?.[1]));
r = await call(leader, "PATCH", `/setlists/${set.id}/items/${items[1].id}`, { timer: { kind: "countdown", duration: -5 } });
check("…a length out of range is refused", r.status === 400, JSON.stringify(r.body));

// --- the stage over /sync
const joined = async (who) => {
  const device = await syncDevice(who);
  device.send({ type: "join", setId: set.id });
  await device.next((m) => m.type === "session");
  return device;
};
const operating = await joined(operator);
const watching = await joined(member);
const stageOf = (device) => device.next((m) => m.type === "session" && m.stage);
watching.send({ type: "stage", message: "Hijacked" });
r = await watching.next((m) => m.type === "error");
check("someone who can't edit the set can't run its screens", r?.code === "forbidden", JSON.stringify(r));
operating.drain();
watching.drain();
operating.send({ type: "stage", timer: { kind: "countdown", duration: 300 }, run: true });
r = await stageOf(watching);
check("an operator who isn't leading starts a countdown: everyone in the set hears it", r?.stage.timer?.kind === "countdown" && r.stage.timer.duration === 300 && r.stage.timer.startedAt > 0, JSON.stringify(r?.stage));
operating.send({ type: "stage", message: "x".repeat(201) });
r = await operating.next((m) => m.type === "error");
check("a message too long is refused", r?.code === "bad-request", JSON.stringify(r));
watching.drain();
// Leading, Live comes to the item with a timer: it starts on the stage.
const leading = await joined(leader);
leading.send({ type: "lead" });
await leading.next((m) => m.type === "session" && m.leading);
watching.drain();
leading.send({ type: "update", itemId: items[1].id });
r = await watching.next((m) => m.type === "session" && m.stage?.timer?.duration === 120, 4000);
check("Live comes to an item with a timer: it starts on the screens", r?.stage.timer.startedAt > 0, JSON.stringify(r?.stage));
leading.send({ type: "end" });
operating.send({ type: "stage", timer: null, message: null });
for (const device of [operating, watching, leading]) device.close();

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  for (const one of [tv, desk]) one.on("pageerror", (error) => errors.push(error.message));

  await step("a stage display on the set; the operator's view, from the set page", async () => {
    page = tv;
    await tv.goto(`${WEB}/screen`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Stage ${stamp}`, mode: "LYRICS", setlistId: set.id, themeTemplate: "stage-display" });
    await tv.getByTestId("screen-grid").waitFor({ timeout: 15000 });
    page = desk;
    await signIn(desk, operator);
    await desk.goto(`${WEB}/sets/${set.id}`);
    await desk.waitForLoadState("networkidle");
    // A set item's timer, picked on the set page.
    await desk.getByTestId("set-song-timer").first().selectOption({ label: "Countdown 3:00" });
    for (let i = 0; i < 20 && (await api(leader, "GET", `/setlists/${set.id}`)).items[0].timer?.duration !== 180; i++) await desk.waitForTimeout(250);
    if ((await api(leader, "GET", `/setlists/${set.id}`)).items[0].timer?.duration !== 180) throw new Error("the item's timer wasn't saved");
    await desk.getByTestId("set-operate").click();
    await desk.waitForURL(`${WEB}/sets/${set.id}/operate`);
    await desk.getByTestId("operator-control").waitFor();
    // Live mode (issue #277), the set's songs in the sidebar.
    if ((await desk.evaluate(() => localStorage.getItem("songverse.mode"))) !== "live") throw new Error("not in Live mode");
    if ((await desk.getByTestId("sidebar-operate-item").count()) !== 2) throw new Error("the sidebar doesn't list the set's songs");
    // The screens connected, in the drawer.
    await desk.getByTestId("operator-drawer-open").click();
    await desk.getByTestId("operator-drawer").getByTestId("operator-screens").getByText(`Stage ${stamp}`).waitFor({ timeout: 10000 });
    await desk.keyboard.press("Escape");
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
    await desk.getByTestId("operator-tab-stage").click();
    await desk.getByTestId("operator-timer").waitFor();
  });

  await step("a 5-minute countdown, started: on the stage display, ticking; a minute more", async () => {
    await desk.getByTestId("operator-preset-5").click();
    await desk.getByTestId("operator-timer-readout").getByText("5:00").waitFor();
    await desk.getByTestId("operator-timer-run").click();
    page = tv;
    await tv.locator('[data-testid="widget-countdown"] [data-running]').waitFor({ timeout: 5000 });
    await tv.waitForFunction(() => /^4:5\d$/.test(document.querySelector('[data-testid="widget-countdown"]')?.textContent?.trim() ?? ""), null, { timeout: 5000 });
    page = desk;
    await desk.getByTestId("operator-timer-more").click();
    page = tv;
    await tv.waitForFunction(() => /^5:5\d$/.test(document.querySelector('[data-testid="widget-countdown"]')?.textContent?.trim() ?? ""), null, { timeout: 5000 });
  });

  await step("paused and reset: the stage display holds, then shows it whole again", async () => {
    page = desk;
    await desk.getByTestId("operator-timer-run").click();
    page = tv;
    await tv.locator('[data-testid="widget-countdown"] [data-running]').waitFor({ state: "detached", timeout: 5000 });
    page = desk;
    await desk.getByTestId("operator-timer-reset").click();
    page = tv;
    await tv.getByTestId("widget-countdown").getByText("6:00").waitFor({ timeout: 5000 });
  });

  await step("a quick message, then one typed, then cleared", async () => {
    page = desk;
    await desk.getByTestId("operator-quick-wrapUp").click();
    page = tv;
    await tv.getByTestId("widget-message").getByText("Wrap up").waitFor({ timeout: 5000 });
    page = desk;
    await desk.getByTestId("operator-message-input").fill(`Next: announcements ${stamp}`);
    await desk.getByTestId("operator-message-send").click();
    page = tv;
    await tv.getByTestId("widget-message").getByText(`Next: announcements ${stamp}`).waitFor({ timeout: 5000 });
    page = desk;
    await desk.getByTestId("operator-message-shown").getByText(`Next: announcements ${stamp}`).waitFor();
    await desk.getByTestId("operator-message-clear").click();
    page = tv;
    await tv.getByTestId("widget-message").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("the slides (issue #275): the screens taken, shared; a tile sends its slide", async () => {
    page = desk;
    await desk.getByTestId("operator-tab-slides").click();
    const tiles = desk.getByTestId("operator-slide");
    await tiles.first().waitFor();
    if (!(await tiles.first().isDisabled())) throw new Error("slides could be sent before taking the screens");
    await desk.getByTestId("operator-take-shared").click();
    await desk.locator('[data-testid="operator-control"][data-control="shared"]').waitFor();
    await tiles.first().click();
    page = tv;
    await tv.getByTestId("widget-current-slide").getByText("A line here").waitFor({ timeout: 10000 });
    page = desk;
    await desk.locator('[data-testid="operator-slide"][aria-current="true"]').waitFor();
    // The sidebar marks the item on the screens.
    await desk.locator('[data-testid="sidebar-operate-item"]:has([data-testid="sidebar-now"])').getByText(`Opening ${stamp}`).waitFor();
  });

  await step("alone: the leader's Live can't present; given back, it can", async () => {
    const leading = await syncDevice(leader);
    leading.send({ type: "join", setId: set.id });
    await leading.next((m) => m.type === "session");
    leading.send({ type: "lead" });
    await leading.next((m) => m.type === "session" && m.leading);
    page = desk;
    await desk.getByTestId("operator-control-switch").click();
    await desk.locator('[data-testid="operator-control"][data-control="exclusive"]').waitFor();
    await leading.next((m) => m.type === "session" && m.session?.screens?.exclusive);
    leading.send({ type: "update", presenting: { itemId: items[1].id, slide: 0, black: false } });
    const refused = await leading.next((m) => m.type === "error");
    if (refused?.code !== "forbidden") throw new Error(JSON.stringify(refused));
    await desk.getByTestId("operator-control-release").click();
    await desk.locator('[data-testid="operator-control"][data-control="none"]').waitFor();
    leading.drain();
    leading.send({ type: "update", presenting: { itemId: items[1].id, slide: 0, black: false } });
    const moved = await leading.next((m) => m.type === "session" && m.session?.presenting?.itemId === items[1].id);
    if (!moved) throw new Error("the leader couldn't present once given back");
    leading.send({ type: "update", presenting: { itemId: items[0].id, slide: 0, black: false } });
    leading.close();
    await desk.getByTestId("operator-take-shared").click();
    await desk.locator('[data-testid="operator-control"][data-control="shared"]').waitFor();
  });

  await step("layers: the words hidden, then a title card over everything", async () => {
    page = desk;
    await desk.getByTestId("operator-drawer-open").click();
    const drawer = desk.getByTestId("operator-drawer");
    // A layer's box follows the stage the server sends back.
    const toggleLayer = async (name, on) => {
      const box = drawer.getByTestId(`operator-layer-${name}`);
      await box.click();
      await drawer.locator(`[data-testid="operator-layer-${name}"]${on ? ":checked" : ":not(:checked)"}`).waitFor({ timeout: 5000 });
    };
    await toggleLayer("words", false);
    page = tv;
    await tv.getByTestId("widget-current-slide").waitFor({ state: "detached", timeout: 5000 });
    page = desk;
    await toggleLayer("words", true);
    await toggleLayer("title", true);
    page = tv;
    await tv.getByTestId("screen-overlay").getByText(`Stage ${stamp}`).waitFor({ timeout: 5000 });
    page = desk;
    await toggleLayer("title", false);
    page = tv;
    await tv.getByTestId("screen-overlay").waitFor({ state: "detached", timeout: 5000 });
    await tv.getByTestId("widget-current-slide").waitFor();
    await desk.keyboard.press("Escape");
  });

  await step("the keyboard (issue #277): the arrows into the next song and back, black, layers, stop, Enter", async () => {
    page = desk;
    const at = (item) => tv.locator(`[data-testid="screen-showing"][data-item="${item}"]`);
    // A tab focused: the arrows are still the slides'.
    await desk.getByTestId("operator-tab-slides").click();
    await desk.keyboard.press("ArrowRight");
    await at(items[1].id).waitFor({ timeout: 10000 });
    await desk.locator('[data-testid="sidebar-operate-item"]:has([data-testid="sidebar-now"])').getByText(`Sermon song ${stamp}`).waitFor();
    await desk.getByTestId("sidebar-operate-item").filter({ hasText: `Opening ${stamp}` }).getByTestId("sidebar-played").waitFor();
    if (!(await desk.getByTestId("operator-slides").isVisible())) throw new Error("the arrows switched the tab");
    await desk.keyboard.press("ArrowLeft");
    await at(items[0].id).waitFor({ timeout: 10000 });
    await desk.keyboard.press("b");
    await tv.locator('[data-testid="screen-showing"][data-black="true"]').waitFor({ timeout: 5000 });
    await desk.keyboard.press("b");
    await tv.locator('[data-testid="screen-showing"][data-black="false"]').waitFor({ timeout: 5000 });
    await desk.keyboard.press("w");
    await tv.getByTestId("widget-current-slide").waitFor({ state: "detached", timeout: 5000 });
    await desk.keyboard.press("t");
    await tv.getByTestId("screen-overlay").waitFor({ timeout: 5000 });
    await desk.keyboard.press("c");
    await tv.getByTestId("screen-overlay").waitFor({ state: "detached", timeout: 5000 });
    await tv.getByTestId("widget-current-slide").waitFor({ timeout: 5000 });
    await desk.keyboard.press("s");
    await at("").waitFor({ timeout: 5000 });
    // Enter, with nothing focused (a focused button keeps its own): the song looked at, put up again.
    await desk.getByRole("heading", { name: "Operator" }).click();
    await desk.keyboard.press("Enter");
    await at(items[0].id).waitFor({ timeout: 5000 });
    await desk.getByTestId("operator-keys").click();
    await desk.getByTestId("operator-keys-list").getByText("Black screen, or back").waitFor();
    await desk.keyboard.press("Escape");
    await desk.getByTestId("operator-keys-list").waitFor({ state: "detached" });
  });

  await step("notes on the slides: all of them, or only those of a team position", async () => {
    page = desk;
    await desk.getByTestId("operator-notes").check();
    const notes = desk.getByTestId("operator-slides").getByTestId("operator-note");
    await notes.getByText(`Lights down ${stamp}`).waitFor();
    await notes.getByText(`Capo 2 ${stamp}`).waitFor();
    await desk.getByTestId("operator-notes-position").selectOption({ label: `Media ${stamp}'s notes` });
    await notes.getByText(`Capo 2 ${stamp}`).waitFor({ state: "detached" });
    await notes.getByText(`Lights down ${stamp}`).waitFor();
  });

  await step("someone who can't edit the set: no operator's controls", async () => {
    page = desk;
    await desk.context().clearCookies();
    await signIn(desk, member);
    await desk.goto(`${WEB}/sets/${set.id}/operate`);
    await desk.getByTestId("operator-not-allowed").waitFor({ timeout: 10000 });
    if ((await desk.getByTestId("operator-timer").count()) > 0) throw new Error("the controls are shown");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
  for (const screen of await api(leader, "GET", "/screens")) await api(leader, "DELETE", `/screens/${screen.id}`);
}
finish();
