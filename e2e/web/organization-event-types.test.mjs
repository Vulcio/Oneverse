// An organisation's event types (issue #528), in the browser: its admin adds
// the suggested Service from the organisation's page; a group's calendar then
// lists it, marked with the organisation's name and not editable there, and
// a new event picked from it gets its parts - the music leader's place open
// to the group itself.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const shots = process.env.E2E_SHOTS;
const admin = await user("Orla Types");
const globalAdmin = await user("Orla Global");
sql(`update "User" set "isGlobalAdmin"=true where id='${globalAdmin.id}'`);
await api(globalAdmin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(admin, "POST", "/organizations", { name: `Org types web ${stamp}` });
const music = await api(admin, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", deviceScaleFactor: shots ? 2 : 1 });

  await step("the organisation's admin adds the suggested Service", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.getByTestId("organization-event-types").click();
    const dialog = page.getByTestId("event-types-dialog");
    await dialog.getByTestId("event-type-suggest-service").click();
    await dialog.locator('[data-event-type="Service"]').getByText("Host, Speaker, Music, Media operator").waitFor();
    if (shots) await dialog.screenshot({ path: `${shots}/organization-event-types.png` });
    await page.keyboard.press("Escape");
  });

  await step("a group lists it, marked with the organisation, and a new event takes its parts", async () => {
    await page.goto(`${WEB}/teams/${music.id}`);
    const calendar = page.getByTestId("team-calendar");
    await calendar.getByTestId("calendar-event-types").click();
    const row = page.getByTestId("event-types-dialog").locator('[data-event-type="Service"]');
    await row.getByTestId("event-type-organization").getByText(org.name).waitFor();
    if (await row.getByTestId("event-type-edit").count()) throw new Error("the group can edit the organisation's type");
    await page.keyboard.press("Escape");
    await page.getByTestId("event-types-dialog").waitFor({ state: "hidden" });
    await calendar.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByTestId("event-type").selectOption({ label: "Service" });
    const leader = dialog.locator('[data-part="MUSIC_LEADER"]');
    if (!(await leader.getByTestId("event-part-required").isChecked())) throw new Error("the music leader isn't required");
    if (!(await leader.getByTestId("event-part-from").inputValue())) throw new Error("the music leader's place comes from no team");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
    await calendar.locator("[data-event-date]").filter({ hasText: "Service" }).first().getByTestId("lineup-missing").waitFor();
  });
} finally {
  await browser.close();
  await api(globalAdmin, "DELETE", `/admin/organizations/${org.id}`).catch(() => {});
  await api(globalAdmin, "DELETE", "/admin/organizations/settings").catch(() => {});
}
await finish();
