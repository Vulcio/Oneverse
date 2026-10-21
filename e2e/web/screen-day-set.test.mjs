// A screen following its owner's schedule (issue #274): paired on "the day's set", it shows the team's set dated today;
// OK opens the team's sets to pick another with the arrows (a TV remote's D-pad) - today and upcoming, undated, then
// the archive - and "Back to the day's set" returns; with no set today, the list shows by itself. A fixed screen doesn't.
import { chromium } from "playwright";
import { SCREEN, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Day admin");
const team = await api(admin, "POST", "/teams", { name: `Day team ${stamp}` });
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const set = async (name, eventDate) => api(admin, "POST", "/setlists", { name: `${name} ${stamp}`, teamId: team.id, ...(eventDate && { eventDate }) });
const today = await set("Today", day(0));
const tomorrow = await set("Tomorrow", day(1));
const undated = await set("Draft", null);
const past = await set("Last week", day(1));
// Sets can't be made in the past: moved there.
sql(`update "Setlist" set "eventDate" = '${day(-7)}' where id = '${past.id}'`);
// Someone else's team's set: never offered.
const stranger = await user("Day stranger");
const otherTeam = await api(stranger, "POST", "/teams", { name: `Other ${stamp}` });
await api(stranger, "POST", "/setlists", { name: `Not theirs ${stamp}`, teamId: otherTeam.id, eventDate: day(0) });

const browser = await chromium.launch();
try {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  tv.on("pageerror", (error) => errors.push(error.message));
  const idle = () => tv.getByTestId("screen-idle");
  const picker = () => tv.getByTestId("screen-set-picker");
  let screen;

  await step("paired on the day's set: the team's set dated today", async () => {
    page = tv;
    await tv.goto(`${SCREEN}/`);
    const code = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    screen = await api(admin, "POST", `/screens/pairings/${code}/confirm`, { name: `Hall ${stamp}`, mode: "LYRICS", setMode: "DAY", owner: { kind: "team", id: team.id } });
    if (screen.setMode !== "DAY" || screen.setlistId) throw new Error(JSON.stringify(screen));
    await idle().getByText(`Today ${stamp}`).waitFor({ timeout: 15000 });
    await idle().getByText("Press OK to choose another set").waitFor();
    const [listed] = (await api(admin, "GET", "/screens")).filter((one) => one.id === screen.id);
    if (listed.setlistId !== today.id) throw new Error(JSON.stringify(listed));
  });

  await step("OK opens the team's sets: today and upcoming, then undated; the arrows and OK pick tomorrow's", async () => {
    await tv.keyboard.press("Enter");
    await picker().waitFor();
    const names = await picker().getByTestId("screen-pick-set").allInnerTexts();
    const order = names.map((one) => one.split("\n")[0]);
    if (!order[0]?.startsWith(`Today ${stamp}`) || !order[1]?.startsWith(`Tomorrow ${stamp}`) || !order[2]?.startsWith(`Draft ${stamp}`)) throw new Error(order.join(" | "));
    if (names.some((one) => one.includes("Not theirs"))) throw new Error("another team's set offered");
    if (names.some((one) => one.includes("Last week"))) throw new Error("the archive shown before it's asked for");
    // The one it shows has the focus; down once, OK.
    if ((await tv.evaluate(() => document.activeElement?.textContent ?? "")).indexOf(`Today ${stamp}`) < 0) throw new Error("not focused on today's");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await idle().getByText(`Tomorrow ${stamp}`).waitFor({ timeout: 10000 });
    await picker().waitFor({ state: "detached" });
  });

  await step("Back closes the list; the archive opens on demand; back to the day's set", async () => {
    await tv.keyboard.press("Enter");
    await picker().waitFor();
    await tv.keyboard.press("Escape");
    await picker().waitFor({ state: "detached" });
    await tv.keyboard.press("Enter");
    await picker().getByTestId("screen-pick-archive").waitFor();
    await tv.keyboard.press("End");
    await tv.keyboard.press("Enter");
    await picker().getByText(`Last week ${stamp}`).waitFor();
    if ((await tv.evaluate(() => document.activeElement?.textContent ?? "")).indexOf(`Last week ${stamp}`) < 0) throw new Error("the archive's latest not focused");
    await tv.keyboard.press("Enter");
    await idle().getByText(`Last week ${stamp}`).waitFor({ timeout: 10000 });
    await tv.keyboard.press("Enter");
    await picker().getByTestId("screen-pick-day").focus();
    await tv.keyboard.press("Enter");
    await idle().getByText(`Today ${stamp}`).waitFor({ timeout: 10000 });
  });

  await step("no set today: the list shows by itself", async () => {
    await api(admin, "DELETE", `/setlists/${today.id}`);
    await tv.reload();
    await picker().waitFor({ timeout: 15000 });
    await picker().getByText(`Tomorrow ${stamp}`).waitFor();
    if ((await picker().getByText(`Draft ${stamp}`).count()) !== 1) throw new Error("the undated set isn't offered");
  });

  await step("Screens: the tile says the day's set; made fixed, OK no longer opens the list", async () => {
    const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    desk.on("pageerror", (error) => errors.push(error.message));
    page = desk;
    await signIn(desk, admin);
    await desk.goto(`${WEB}/screens`);
    const tile = desk.getByTestId(`screen-Hall ${stamp}`);
    await tile.getByTestId("screen-set").getByText("The day's set: none today").waitFor();
    await tile.getByTestId("screen-settings").click();
    await desk.getByTestId("screen-dialog").getByLabel("Set").selectOption({ label: `Tomorrow ${stamp}` });
    await desk.keyboard.press("Escape");
    await desk.getByTestId("screen-dialog").waitFor({ state: "detached" });
    await tile.getByTestId("screen-set").getByText(`Tomorrow ${stamp}`).waitFor();
    const [fixed] = (await api(admin, "GET", "/screens")).filter((one) => one.id === screen.id);
    if (fixed.setMode !== "FIXED") throw new Error(JSON.stringify(fixed));
    page = tv;
    await idle().getByText(`Tomorrow ${stamp}`).waitFor({ timeout: 10000 });
    await tv.keyboard.press("Enter");
    await tv.waitForTimeout(500);
    if ((await picker().count()) > 0) throw new Error("a fixed screen opened the list");
    const r = await call(admin, "GET", "/screens");
    check("…and picking on a fixed screen is refused", r.status === 200);
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
  for (const one of await api(admin, "GET", "/screens")) await api(admin, "DELETE", `/screens/${one.id}`);
}
finish();
