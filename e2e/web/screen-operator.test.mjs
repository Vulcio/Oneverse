// The media operator (issue #269): a set's timer and message for its screens, run over /sync by anyone who can
// edit the set - leading or not - and refused to anyone else; a set item's own timer, started when Live comes to it;
// the operator's page: a countdown started, a minute more, a message sent and cleared, all on a stage display;
// the console refined (issue #358): named timers, the team's saved timers and quick messages, what's up and
// what's next, the running order and section jumps, where things stand, and its layout at a tablet's and a wide width;
// the screens drawn as they are, in a grid or one at a time, a layer cleared on one of them; the console's Display
// options on the device; the sidebar's Operator opening the next set's console.
import { chromium } from "playwright";
import { SCREEN, WEB, api, call, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
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
// A song in sections (issue #358): what the section jumps go to.
const closing = await api(leader, "POST", "/song-versions", {
  title: `Closing ${stamp}`,
  language: "en",
  artists: ["Someone"],
  teamId: team.id,
  content: "{start_of_verse}\nFirst verse line\n{end_of_verse}\n\n{start_of_chorus}\nChorus line here\n{end_of_chorus}\n\n{start_of_verse}\nSecond verse line\n{end_of_verse}\n",
  contentFormat: "CHORDPRO",
});
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: closing.id });
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

// --- the operator's presets (issue #358): the team's, for every set of it
const otherSet = await api(leader, "POST", "/setlists", { name: `Stage other ${stamp}`, teamId: team.id });
r = await call(member, "GET", `/setlists/${set.id}/operator-presets`);
check("a team member reads the set's operator presets: the built-in ones, not theirs to change", r.status === 200 && r.body.timers === null && r.body.messages === null && r.body.canEdit === false && r.body.owner.kind === "team", JSON.stringify(r.body));
r = await call(member, "PUT", `/setlists/${set.id}/operator-presets`, { messages: ["Hijacked"] });
check("…and can't change them", r.status === 403, JSON.stringify(r.body));
r = await call(leader, "PUT", `/setlists/${set.id}/operator-presets`, { timers: [{ name: "Sermon", kind: "countdown", duration: 1500 }], messages: ["Pray"] });
check("the team's admin saves timers and messages", r.status === 200 && r.body.timers?.[0]?.duration === 1500 && r.body.messages?.[0] === "Pray" && r.body.canEdit, JSON.stringify(r.body));
r = await call(operator, "GET", `/setlists/${otherSet.id}/operator-presets`);
check("…the same for every set of the team", r.status === 200 && r.body.timers?.[0]?.name === "Sermon" && r.body.messages?.[0] === "Pray", JSON.stringify(r.body));
r = await call(leader, "PUT", `/setlists/${set.id}/operator-presets`, { timers: [{ name: "", kind: "countdown", duration: 60 }] });
check("…a timer without a name is refused", r.status === 400, JSON.stringify(r.body));
r = await call(leader, "PUT", `/setlists/${set.id}/operator-presets`, { messages: null });
check("…the messages back to the built-in ones, the timers kept", r.status === 200 && r.body.messages === null && r.body.timers?.length === 1, JSON.stringify(r.body));
await call(leader, "PUT", `/setlists/${set.id}/operator-presets`, { timers: null });
const ownSet = await api(member, "POST", "/setlists", { name: `Own ${stamp}` });
r = await call(member, "PUT", `/setlists/${ownSet.id}/operator-presets`, { messages: ["Mine"] });
check("a personal set's presets are its owner's", r.status === 200 && r.body.owner.kind === "user" && r.body.messages?.[0] === "Mine", JSON.stringify(r.body));

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
// Named timers (issue #358): one started beside the main one, which is still what an older client reads.
operating.send({ type: "stage", timerId: "t-sermon", timer: { kind: "countdown", duration: 1800, name: "Sermon" }, run: true });
r = await watching.next((m) => m.type === "session" && m.stage?.timers?.length === 2);
check("a named timer runs beside the main one", r?.stage.timers[0].id === "main" && r.stage.timers[1].name === "Sermon" && r.stage.timers[1].startedAt > 0 && r.stage.timer?.duration === 300, JSON.stringify(r?.stage));
operating.send({ type: "stage", timerId: "t-sermon", run: false });
r = await watching.next((m) => m.type === "session" && m.stage?.timers?.[1]?.startedAt === null);
check("…paused on its own, the main one still running", r?.stage.timers[0].startedAt > 0, JSON.stringify(r?.stage));
operating.send({ type: "stage", timerId: "t-sermon", timer: null });
r = await watching.next((m) => m.type === "session" && m.stage?.timers?.length === 1);
check("…taken away", r?.stage.timers[0].id === "main", JSON.stringify(r?.stage));
operating.send({ type: "stage", timerId: "not ok", timer: { kind: "countdown", duration: 60 } });
r = await operating.next((m) => m.type === "error");
check("…a timer id that can't be read is refused", r?.code === "bad-request", JSON.stringify(r));
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
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Stage ${stamp}`, mode: "LYRICS", setlistId: set.id, themeTemplate: "stage-display" });
    await tv.getByTestId("screen-grid").first().waitFor({ timeout: 15000 });
    // How the set's screens look (issue #358): for who runs them, not for a member.
    r = await call(operator, "GET", `/screens/looks?setlistId=${set.id}`);
    if (r.status !== 200 || r.body.screens.length !== 1 || !r.body.screens[0].theme || !Array.isArray(r.body.assets) || !r.body.credits[songs[0].id]) throw new Error(`looks: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    r = await call(member, "GET", `/screens/looks?setlistId=${set.id}`);
    if (r.status !== 403) throw new Error(`a member reads the screens' looks: ${r.status}`);
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
    if ((await desk.getByTestId("sidebar-operate-item").count()) !== 3) throw new Error("the sidebar doesn't list the set's songs");
    // The screens connected, in the drawer.
    await desk.getByTestId("operator-drawer-open").click();
    await desk.getByTestId("operator-drawer").locator('[data-testid="operator-screen-tile"][data-state="following"]').getByText(`Stage ${stamp}`).first().waitFor({ timeout: 10000 });
    // Beside the page, as the Display panel is (issue #278): the page makes room rather than going under it.
    await desk.waitForTimeout(400);
    const panel = await desk.getByTestId("operator-drawer").boundingBox();
    const bar = await desk.getByTestId("operator-control").boundingBox();
    if (!panel || !bar || bar.x + bar.width > panel.x + 1) throw new Error(`the panel covers the page: ${JSON.stringify({ panel, bar })}`);
    await desk.getByTestId("operator-drawer-close").click();
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
    // Beside the sidebar on a laptop (issue #358): the running order in a column, the slides first, the timers and messages a tab away.
    await desk.locator('[data-testid="operator"][data-columns="2"]').waitFor();
    await desk.locator('[data-testid="operator-rundown"]:not([data-strip])').waitFor();
    await desk.getByTestId("operator-slides").waitFor();
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
    page = desk;
    await desk.getByTestId("operator-tab-slides").click();
  });

  await step("the slides (issue #275): sent without taking the screens (issue #305), then taken, shared; a tile sends its slide", async () => {
    page = desk;
    const tiles = desk.getByTestId("operator-slide");
    await tiles.first().waitFor();
    // Split control (issue #305): whoever can edit the set presents beside the leader, no need to take the screens first.
    if (await tiles.first().isDisabled()) throw new Error("slides couldn't be sent before taking the screens");
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

  await step("layers: the content hidden, then a title card over everything", async () => {
    page = desk;
    await desk.getByTestId("operator-drawer-open").click();
    const drawer = desk.getByTestId("operator-drawer");
    // A layer's toggle follows the stage the server sends back.
    const toggleLayer = async (name, on) => {
      await drawer.getByTestId(`operator-layer-${name}`).click();
      await drawer.locator(`[data-testid="operator-layer-${name}"][aria-pressed="${on}"]`).waitFor({ timeout: 5000 });
    };
    await toggleLayer("content", false);
    page = tv;
    await tv.getByTestId("widget-current-slide").waitFor({ state: "detached", timeout: 5000 });
    page = desk;
    await toggleLayer("content", true);
    await toggleLayer("title", true);
    page = tv;
    await tv.getByTestId("screen-overlay").getByText(`Stage ${stamp}`).waitFor({ timeout: 5000 });
    page = desk;
    await toggleLayer("title", false);
    page = tv;
    await tv.getByTestId("screen-overlay").waitFor({ state: "detached", timeout: 5000 });
    await tv.getByTestId("widget-current-slide").waitFor();
    // The panel open, the page still takes taps and keys.
    page = desk;
    await desk.getByRole("heading", { name: "Operator" }).click();
    await drawer.waitFor();
    await desk.keyboard.press("t");
    await tv.getByTestId("screen-overlay").waitFor({ timeout: 5000 });
    await desk.keyboard.press("t");
    await tv.getByTestId("screen-overlay").waitFor({ state: "detached", timeout: 5000 });
    await desk.getByTestId("operator-drawer-open").click();
    await drawer.waitFor({ state: "detached" });
  });

  await step("the keyboard (issue #277): the arrows into the next song and back, black, layers, stop, Enter", async () => {
    page = desk;
    const at = (item) => tv.locator(`[data-testid="screen-showing"][data-item="${item}"]`);
    // From the first song's slide, on the screens and marked here: the step before may have left another one up
    // (the leader's Live presented the next song), and an arrow pressed then moves on from there.
    await desk.getByTestId("operator-rundown-item").filter({ hasText: `Opening ${stamp}` }).first().click();
    await desk.getByTestId("operator-slide").first().click();
    await at(items[0].id).waitFor({ timeout: 10000 });
    await desk.locator('[data-testid="operator-rundown-item"][data-live]').getByText(`Opening ${stamp}`).waitFor({ timeout: 5000 });
    // A button focused: the arrows are still the slides'.
    await desk.getByTestId("operator-slide").first().focus();
    await desk.keyboard.press("ArrowRight");
    await at(items[1].id).waitFor({ timeout: 10000 });
    await desk.locator('[data-testid="sidebar-operate-item"]:has([data-testid="sidebar-now"])').getByText(`Sermon song ${stamp}`).waitFor();
    await desk.getByTestId("sidebar-operate-item").filter({ hasText: `Opening ${stamp}` }).getByTestId("sidebar-played").waitFor();
    await desk.keyboard.press("ArrowLeft");
    await at(items[0].id).waitFor({ timeout: 10000 });
    await desk.keyboard.press("b");
    await tv.locator('[data-testid="screen-showing"][data-black="true"]').waitFor({ timeout: 5000 });
    // The page shows it too (Black screen pressed), as the operator would see before pressing again.
    await desk.locator('[data-testid="operator-black"][aria-pressed="true"]').waitFor({ timeout: 5000 });
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

  await step("what's up and what's next (issue #358): the slide on the screens, the next one sent by its tile", async () => {
    page = desk;
    const at = (item) => tv.locator(`[data-testid="screen-showing"][data-item="${item}"]`);
    // At the top of Screens & layers.
    await desk.getByTestId("operator-drawer-open").click();
    await desk.getByTestId("operator-on-screens").getByText("A line here").waitFor({ timeout: 5000 });
    await desk.getByTestId("operator-state-presenting").getByText(`Opening ${stamp}`).waitFor();
    await desk.locator('[data-testid="operator-state-screens"][data-count="1"]').waitFor();
    await desk.getByTestId("operator-next-slide").getByText(`Sermon song ${stamp}`).waitFor();
    await desk.getByTestId("operator-next-slide").click();
    await at(items[1].id).waitFor({ timeout: 5000 });
    await desk.locator('[data-testid="operator-rundown-item"][data-live]').getByText(`Sermon song ${stamp}`).waitFor({ timeout: 5000 });
    await desk.getByRole("heading", { name: "Operator" }).click();
    await desk.keyboard.press("b");
    await desk.locator('[data-testid="operator-on-screens"][data-state="black"]').waitFor({ timeout: 5000 });
    await desk.keyboard.press("b");
    await desk.locator('[data-testid="operator-on-screens"][data-state="shown"]').waitFor({ timeout: 5000 });
    await desk.getByTestId("operator-drawer-close").click();
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
  });

  await step("the running order and section jumps (issue #358): a song looked at, its sections by a press or a digit", async () => {
    page = desk;
    await desk.getByTestId("operator-rundown-item").filter({ hasText: `Closing ${stamp}` }).click();
    const sections = desk.getByTestId("operator-section");
    await sections.nth(2).waitFor();
    if ((await sections.count()) !== 3) throw new Error(`${await sections.count()} sections`);
    await sections.nth(1).click();
    page = tv;
    await tv.getByTestId("widget-current-slide").getByText("Chorus line here").waitFor({ timeout: 5000 });
    page = desk;
    await desk.locator('[data-testid="operator-section"][aria-current="true"]').getByText("Chorus").waitFor();
    await desk.getByRole("heading", { name: "Operator" }).click();
    await desk.keyboard.press("3");
    page = tv;
    await tv.getByTestId("widget-current-slide").getByText("Second verse line").waitFor({ timeout: 5000 });
    page = desk;
    await desk.keyboard.press("1");
    page = tv;
    await tv.getByTestId("widget-current-slide").getByText("First verse line").waitFor({ timeout: 5000 });
    // The set's last slide: nothing next.
    page = desk;
    await desk.keyboard.press("End");
    await desk.getByTestId("operator-drawer-open").click();
    await desk.getByTestId("operator-next-slide").getByText("End of the set").waitFor({ timeout: 5000 });
    await desk.getByTestId("operator-drawer-close").click();
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
    // Back to the first song for what follows.
    await desk.getByTestId("operator-rundown-item").filter({ hasText: `Opening ${stamp}` }).click();
    await desk.getByTestId("operator-slide").first().click();
    await tv.locator(`[data-testid="screen-showing"][data-item="${items[0].id}"]`).waitFor({ timeout: 5000 });
  });

  await step("named timers (issue #358): one started from the built-in ones, shown by an unnamed countdown once there's no main timer", async () => {
    page = desk;
    await desk.getByTestId("operator-tab-stage").click();
    await desk.getByTestId("operator-timer-clear").click();
    await desk.getByTestId("operator-timer-readout").getByText("–:––").waitFor({ timeout: 5000 });
    await desk.locator('[data-testid="operator-timer-preset"][data-name="Sermon"]').click();
    const row = desk.locator('[data-testid="operator-named-timer"][data-name="Sermon"]');
    await desk.locator('[data-testid="operator-named-timer"][data-name="Sermon"][data-running]').waitFor({ timeout: 5000 });
    page = tv;
    await tv.waitForFunction(() => /^(30:00|29:5\d)$/.test(document.querySelector('[data-testid="widget-countdown"]')?.textContent?.trim() ?? ""), null, { timeout: 5000 });
    page = desk;
    // Pressed again: the same timer started over, not a second one.
    await desk.locator('[data-testid="operator-timer-preset"][data-name="Sermon"]').click();
    await desk.waitForTimeout(500);
    if ((await desk.getByTestId("operator-named-timer").count()) !== 1) throw new Error("a second Sermon timer");
    await row.getByTestId("operator-named-timer-run").click();
    await desk.locator('[data-testid="operator-named-timer"][data-name="Sermon"]:not([data-running])').waitFor({ timeout: 5000 });
    await row.getByTestId("operator-named-timer-remove").click();
    await row.waitFor({ state: "detached", timeout: 5000 });
    page = tv;
    await tv.getByTestId("widget-countdown").getByText("–:––").waitFor({ timeout: 5000 });
  });

  await step("the team's own timers and quick messages (issue #358): edited from the console, used at once", async () => {
    page = desk;
    await desk.getByTestId("operator-presets-edit").click();
    const dialog = desk.getByTestId("operator-presets");
    await dialog.getByTestId("operator-presets-timer").first().waitFor();
    await dialog.getByTestId("operator-presets-add-timer").click();
    const added = dialog.getByTestId("operator-presets-timer").last();
    await added.getByTestId("operator-presets-timer-name").fill(`Offering ${stamp}`);
    await added.getByTestId("operator-presets-timer-minutes").fill("2");
    const messages = dialog.getByTestId("operator-presets-message");
    while ((await messages.count()) > 0) await messages.first().getByRole("button").click();
    await dialog.getByTestId("operator-presets-add-message").click();
    await messages.first().getByTestId("operator-presets-message-text").fill(`Pray for ${stamp}`);
    await dialog.getByTestId("operator-presets-save").click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    const saved = await api(leader, "GET", `/setlists/${set.id}/operator-presets`);
    if (saved.timers?.at(-1)?.name !== `Offering ${stamp}` || saved.timers.at(-1).duration !== 120 || saved.messages?.join() !== `Pray for ${stamp}`) throw new Error(JSON.stringify(saved));
    // The message card has them too, without a reload.
    await desk.locator("[data-quick]").getByText(`Pray for ${stamp}`).click();
    page = tv;
    await tv.getByTestId("widget-message").getByText(`Pray for ${stamp}`).waitFor({ timeout: 5000 });
    page = desk;
    await desk.getByTestId("operator-drawer-open").click();
    await desk.getByTestId("operator-on-screens-message").getByText(`Pray for ${stamp}`).waitFor();
    await desk.getByTestId("operator-drawer-close").click();
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
    await desk.getByTestId("operator-message-clear").click();
    await desk.locator(`[data-testid="operator-timer-preset"][data-name="Offering ${stamp}"]`).click();
    await desk.locator(`[data-testid="operator-named-timer"][data-name="Offering ${stamp}"]`).getByTestId("operator-named-timer-readout").getByText(/^(2:00|1:5\d)$/).waitFor({ timeout: 5000 });
    // Back to the built-in ones.
    await desk.getByTestId("operator-presets-edit").click();
    await dialog.getByTestId("operator-presets-built-in").click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await desk.getByTestId("operator-quick-wrapUp").waitFor();
    await desk.locator(`[data-testid="operator-named-timer"][data-name="Offering ${stamp}"]`).getByTestId("operator-named-timer-remove").click();
    await desk.getByTestId("operator-tab-slides").click();
  });

  await step("a screen of the set that isn't connected (issue #358): named as missing", async () => {
    const lobby = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await lobby.goto(`${SCREEN}/`);
    const code = (await lobby.getByTestId("screen-code").innerText()).replace("-", "");
    await api(leader, "POST", `/screens/pairings/${code}/confirm`, { name: `Lobby ${stamp}`, mode: "LYRICS", setlistId: set.id });
    await lobby.getByTestId("screen-grid").first().waitFor({ timeout: 15000 });
    page = desk;
    await desk.locator('[data-testid="operator-state-screens"][data-count="2"]').waitFor({ timeout: 10000 });
    await lobby.context().close();
    await desk.getByTestId("operator-state-missing").getByText(`Lobby ${stamp}`).waitFor({ timeout: 20000 });
    await desk.getByTestId("operator-state-missing").click();
    await desk.locator('[data-testid="operator-drawer"] [data-testid="operator-screen-tile"][data-state="missing"]').getByText(`Lobby ${stamp}`).first().waitFor();
    await desk.getByTestId("operator-drawer-close").click();
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
  });

  await step("the screens as they are, in Screens & layers (issue #358): a picture of each, a layer cleared on one of them, one screen at a time", async () => {
    page = desk;
    await desk.getByTestId("operator-drawer-open").click();
    const view = desk.getByTestId("operator-drawer").getByTestId("operator-screens-view");
    const stageTile = view.locator('[data-testid="operator-screen-tile"][data-state="following"]').filter({ hasText: `Stage ${stamp}` });
    // Drawn with its own template, showing the slide on the screens.
    await stageTile.getByTestId("screen-grid").first().waitFor({ timeout: 10000 });
    await stageTile.getByTestId("widget-current-slide").waitFor();
    await view.locator('[data-testid="operator-screen-tile"][data-state="missing"]').filter({ hasText: `Lobby ${stamp}` }).getByTestId("operator-screen-missing").waitFor();
    // Its details: its template.
    await stageTile.getByTestId("operator-screen-details").getByText("Stage display").waitFor();
    // Its content cleared there alone, until the next slide; the screen and its picture follow.
    await stageTile.getByTestId("operator-screen-clear").click();
    await stageTile.locator('[data-testid="operator-screen-layer-content"][data-state="cleared"]').waitFor({ timeout: 5000 });
    await stageTile.locator("[data-own-layers]").or(view.locator('[data-testid="operator-screen-tile"][data-own-layers]')).first().waitFor();
    page = tv;
    await tv.getByTestId("widget-current-slide").waitFor({ state: "detached", timeout: 5000 });
    page = desk;
    await stageTile.getByTestId("widget-current-slide").waitFor({ state: "detached", timeout: 5000 });
    // Bring back, in Clear's place meanwhile.
    await stageTile.locator('[data-testid="operator-screen-clear"][data-state="cleared"]').click();
    await stageTile.locator('[data-testid="operator-screen-layer-content"][data-state="shown"]').waitFor({ timeout: 5000 });
    page = tv;
    await tv.getByTestId("widget-current-slide").waitFor({ timeout: 5000 });
    // One at a time: a tab for each, the one picked larger with its layers beside it.
    page = desk;
    await desk.getByTestId("operator-screens-tabs").click();
    if ((await view.getByTestId("operator-screen-tab").count()) !== 2) throw new Error("not a tab for each screen");
    await view.locator('[data-testid="operator-layers"][data-screen]').waitFor();
    // The pictures hidden: each screen a row with its layers, no picture.
    await desk.getByTestId("operator-screens-previews").click();
    await desk.locator('[data-testid="operator-screens-view"][data-view="off"]').waitFor();
    await stageTile.getByTestId("screen-grid").waitFor({ state: "detached" });
    await stageTile.locator('[data-testid="operator-layers"][data-screen]').waitFor();
    await desk.getByTestId("operator-screens-previews").click();
    await desk.getByTestId("operator-screens-grid").click();
    await stageTile.getByTestId("screen-grid").first().waitFor();
    // What's on the screens and what's next sits at the top of the drawer.
    await view.getByTestId("operator-program").waitFor();
    // Its edge dragged: wider, and kept for next time.
    const before = (await desk.getByTestId("operator-drawer").boundingBox()).width;
    const edge = await desk.getByTestId("operator-drawer-resize").boundingBox();
    await desk.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await desk.mouse.down();
    await desk.mouse.move(edge.x - 100, edge.y + 200, { steps: 5 });
    await desk.mouse.up();
    await desk.waitForFunction((width) => (document.querySelector('[data-testid="operator-drawer"]')?.getBoundingClientRect().width ?? 0) > width + 80, before);
    const stored = await desk.evaluate(() => JSON.parse(localStorage.getItem("oneverse.operator.display") ?? "{}").drawerWidth);
    if (!(stored > before + 80)) throw new Error(`the width wasn't kept: ${stored}`);
    await desk.getByTestId("operator-drawer-resize").dblclick();
    await desk.getByTestId("operator-drawer-close").click();
    await desk.getByTestId("operator-drawer").waitFor({ state: "detached" });
  });

  await step("the console's Display options (issue #358): grouped by section, colour on the header, capitals, a size, rows of 2, dark; kept on the device", async () => {
    page = desk;
    await desk.getByTestId("operator-rundown-item").filter({ hasText: `Closing ${stamp}` }).first().click();
    await desk.getByTestId("operator-slide").filter({ hasText: "Chorus line here" }).waitFor();
    await desk.getByTestId("operator-display").click();
    const menu = desk.getByTestId("operator-display-menu");
    await menu.getByTestId("operator-display-grouped").check();
    await menu.getByTestId("operator-display-sectionColor").selectOption("header");
    await menu.getByTestId("operator-display-uppercase").check();
    await menu.getByTestId("operator-display-size-xl").click();
    await menu.getByTestId("operator-display-columns").selectOption("2");
    await menu.getByTestId("operator-display-tiles").selectOption("dark");
    await desk.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    const slides = desk.getByTestId("operator-slides");
    const check = async () => {
      if ((await slides.getByTestId("operator-slide-group").count()) !== 3) throw new Error("not grouped by section");
      if ((await slides.getByTestId("operator-slide-header").count()) !== 3) throw new Error("no coloured headers");
      const tile = slides.getByTestId("operator-slide").filter({ hasText: "Chorus line here" });
      const looks = await tile.evaluate((element) => {
        const words = element.lastElementChild;
        const style = getComputedStyle(words);
        return { transform: style.textTransform, size: parseFloat(style.fontSize), background: getComputedStyle(element).backgroundColor };
      });
      if (looks.transform !== "uppercase" || looks.size < 17 || !/rgb\(10, 10, 10\)|oklch\(0\.14/.test(looks.background)) throw new Error(JSON.stringify(looks));
      const columns = await slides.locator("ul").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      if (columns !== 2) throw new Error(`${columns} slides to a row`);
    };
    await check();
    // Kept on this device.
    await desk.reload();
    await desk.getByTestId("operator-slide").filter({ hasText: "Chorus line here" }).waitFor({ timeout: 15000 });
    await check();
    await desk.getByTestId("operator-display").click();
    await desk.getByTestId("operator-display-reset").click();
    await desk.keyboard.press("Escape");
    if (await slides.getByTestId("operator-slide-group").count()) throw new Error("still grouped after the reset");
  });

  await step("the running order (issue #489): along the top as a row of cards, hidden, back on the left; kept on the device", async () => {
    page = desk;
    const pick = async (where) => {
      await desk.getByTestId("operator-display").click();
      await desk.getByTestId(`operator-display-rundown-${where}`).click();
      await desk.keyboard.press("Escape");
      await desk.getByTestId("operator-display-menu").waitFor({ state: "detached" });
    };
    await pick("top");
    await desk.locator('[data-testid="operator-columns"][data-rundown="top"]').waitFor();
    const row = desk.locator('[data-testid="operator-rundown"][data-layout="row"]');
    await row.waitFor();
    // Above the slides, each item a card with its put-up button.
    const [strip, slides] = await Promise.all([row.boundingBox(), desk.getByTestId("operator-slides").boundingBox()]);
    if (!strip || !slides || strip.y + strip.height > slides.y) throw new Error(`the running order isn't above the slides: ${JSON.stringify({ strip, slides })}`);
    if ((await row.getByTestId("operator-rundown-card").count()) !== 3 || (await row.getByTestId("operator-rundown-present").count()) !== 3) throw new Error("not a card per item");
    await row.getByTestId("operator-rundown-item").filter({ hasText: `Opening ${stamp}` }).click();
    await pick("off");
    await desk.locator('[data-testid="operator-columns"][data-rundown="off"]').waitFor();
    if (await desk.getByTestId("operator-rundown").count()) throw new Error("the running order is still shown");
    await desk.reload();
    await desk.locator('[data-testid="operator-columns"][data-rundown="off"]').waitFor({ timeout: 15000 });
    await pick("left");
    await desk.locator('[data-testid="operator-rundown"][data-layout="column"]').waitFor();
  });

  await step("the sidebar's Operator: the next set's console", async () => {
    page = desk;
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const upcoming = await api(leader, "POST", "/setlists", { name: `Upcoming ${stamp}`, eventDate: soon, teamId: team.id });
    await desk.goto(`${WEB}/sets`);
    await desk.locator('[data-testid="nav-operator"]:visible, [data-testid="rail-operator"]:visible').first().click();
    await desk.waitForURL(`${WEB}/sets/${upcoming.id}/operate`, { timeout: 15000 });
    await desk.getByTestId("operator").waitFor();
    await desk.goto(`${WEB}/sets/${set.id}/operate`);
    await desk.getByTestId("operator-control").waitFor({ timeout: 15000 });
  });

  await step("the console's width (issue #358): the running order in a column of its own when wide; on a tablet, a strip above the slides", async () => {
    page = desk;
    const tablet = await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage();
    tablet.on("pageerror", (error) => errors.push(error.message));
    page = tablet;
    await signIn(tablet, operator);
    await tablet.goto(`${SCREEN}/operate/${set.id}`);
    await tablet.locator('[data-testid="operator"][data-columns="1"]').waitFor({ timeout: 15000 });
    await tablet.getByTestId("operator-slides").waitFor({ timeout: 10000 });
    await tablet.locator('[data-testid="operator-rundown"][data-strip]').waitFor();
    await tablet.getByTestId("operator-tab-stage").click();
    await tablet.getByTestId("operator-timer").waitFor();
    const scroll = await tablet.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (scroll > 0) throw new Error(`the tablet's page scrolls sideways by ${scroll}px`);
    await tablet.context().close();
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
