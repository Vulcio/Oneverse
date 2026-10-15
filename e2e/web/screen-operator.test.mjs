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
    await desk.getByTestId("operator-timer").waitFor();
    await desk.getByTestId("operator-screens").getByText(`Stage ${stamp}`).waitFor({ timeout: 10000 });
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
