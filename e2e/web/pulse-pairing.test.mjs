// Pairing a Oneverse Pulse in Screens (issue #320): a code a Pulse asked for says so, and names it "Pulse"; set to
// follow one of the organisation's locations it's on the event on there now, and its tile shows a Pulse badge and
// "At <location>: <set>". Its settings move it back to a set of one's own.
import { chromium } from "playwright";
import { API, WEB, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Pulse web global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const lead = await user("Pulse web lead");
const org = (await call(lead, "POST", "/organizations", { name: `Pulse web church ${stamp}` })).body;
const music = (await call(lead, "POST", "/teams", { name: `Pulse web music ${stamp}` })).body;
await call(lead, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
await call(lead, "POST", "/locations", { name: `Campus ${stamp}`, timeZone: "UTC", organizationId: org.id });
const location = (await call(lead, "GET", `/locations?organizationId=${org.id}`)).body[0];
const now = new Date();
const today = now.toISOString().slice(0, 10);
const started = new Date(Math.max(now.getTime() - 10 * 60_000, new Date(`${today}T00:00:00Z`).getTime())).toISOString().slice(11, 16);
await call(lead, "POST", `/organizations/${org.id}/events`, { title: `Service ${stamp}`, date: today, startTime: started, timeZone: "UTC", hostUserId: lead.id, locationId: location.id, needs: [{ teamId: music.id }] });
const ownSet = (await call(lead, "POST", "/setlists", { name: `Own set ${stamp}` })).body;
const pulse = await fetch(`${API}/screens/pairings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "PULSE" }) }).then((res) => res.json());

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await signIn(page, lead);

  await step("a Pulse's code says so, and names it", async () => {
    await page.goto(`${WEB}/screens?code=${pulse.code}`);
    await page.getByTestId("screen-pair-pulse").waitFor();
    await page.waitForFunction(() => document.querySelector("#screen-name")?.value === "Pulse");
  });

  await step("paired to follow the organisation's location: on the event on there now, with a Pulse badge", async () => {
    await page.getByTestId("screen-owner").selectOption({ label: `Organisation: Pulse web church ${stamp}` });
    await page.getByTestId("screen-pair-form").getByLabel("Set").selectOption({ label: `Events at Campus ${stamp} (automatic)` });
    await page.getByTestId("screen-pair-form").getByRole("button", { name: "Pair screen" }).click();
    const tile = page.getByTestId("screens-list").getByTestId("screen-Pulse");
    await tile.getByTestId("screen-pulse").waitFor();
    await tile.getByTestId("screen-set").getByText(`At Campus ${stamp}: Service ${stamp}`, { exact: false }).waitFor();
  });

  await step("its settings put a set of one's own on it", async () => {
    const tile = page.getByTestId("screens-list").getByTestId("screen-Pulse");
    await tile.getByTestId("screen-settings").click();
    await page.getByTestId("screen-dialog").getByLabel("Set").selectOption({ label: `Own set ${stamp}` });
    await page.getByTestId("screen-dialog-done").click();
    await tile.getByTestId("screen-set").getByText(`Own set ${stamp}`).waitFor();
    const [screen] = (await call(lead, "GET", "/screens")).body.filter((one) => one.kind === "PULSE");
    if (screen?.setMode !== "FIXED" || screen.setlistId !== ownSet.id) throw new Error(JSON.stringify(screen));
  });
} finally {
  await browser.close();
}
finish();
