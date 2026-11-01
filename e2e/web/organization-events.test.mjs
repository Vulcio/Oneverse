// An organisation's events in the browser (issue #241): its admin keeps a
// preset of what a Sunday needs (drums from the music team, a greeter from
// the welcome team), makes the event from it with a host; each group's
// calendar shows its part, planned by the organisation; the host cancels a
// date for everyone from the organisation's Events.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Orgev web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Orgev web alice");
const host = await user("Orgev web host");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(alice, "POST", "/organizations", { name: `Events web ${stamp}` });
const music = await api(alice, "POST", "/teams", { name: `Music ${stamp}` });
await api(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
const welcome = await api(alice, "POST", `/organizations/${org.id}/groups`, { name: `Welcome ${stamp}` });
await api(alice, "POST", `/teams/${welcome.id}/positions`, { name: "Greeter" });
await api(host, "POST", `/organizations/join/${(await api(alice, "POST", `/organizations/${org.id}/invite-links`, {})).token}`);
const presetName = `Sunday ${stamp}`;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });
  const dialog = () => page.getByTestId("org-event-dialog");

  await step("the admin keeps a preset: drums from music, a greeter from welcome", async () => {
    await signIn(page, alice);
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.getByTestId("organization-events").click();
    await page.waitForURL(/\/events$/);
    await page.getByTestId("org-new-event").click();
    await dialog().getByLabel("Title").fill("Sunday service");
    await dialog().getByTestId("org-event-add-group").selectOption({ label: `Music ${stamp}` });
    await dialog().locator(`[data-need="Music ${stamp}"]`).getByTestId("event-part-add").selectOption({ label: "Drums" });
    await dialog().getByTestId("org-event-add-group").selectOption({ label: `Welcome ${stamp}` });
    await dialog().locator(`[data-need="Welcome ${stamp}"]`).getByTestId("event-part-add").selectOption({ label: "Greeter" });
    await dialog().getByTestId("org-save-preset").click();
    await dialog().getByLabel("Preset name").fill(presetName);
    await dialog().getByTestId("org-preset-save").click();
    await dialog().waitFor({ state: "hidden" });
    await page.getByTestId("org-presets").locator(`[data-preset="${presetName}"]`).waitFor();
  });

  await step("…makes the event from it, with a host", async () => {
    await page.getByTestId("org-new-event").click();
    await dialog().getByTestId("org-event-preset").selectOption({ label: presetName });
    if ((await dialog().getByLabel("Title").inputValue()) !== "Sunday service") throw new Error("the preset didn't fill the title");
    await dialog().getByTestId("org-event-host").selectOption({ label: "Orgev web host" });
    await dialog().getByTestId("org-event-save").click();
    await dialog().waitFor({ state: "hidden" });
    const row = page.locator("[data-org-event-date]").first();
    await row.getByText("Hosted by Orgev web host").waitFor();
    await row.locator(`[data-org-group="${music.id}"]`).getByTestId("org-group-short").getByText("Drums").waitFor();
    await row.locator(`[data-org-group="${welcome.id}"]`).getByTestId("org-group-short").getByText("Greeter").waitFor();
  });

  await step("the music team's calendar: its part, planned by the organisation, only its parts to change", async () => {
    await page.goto(`${WEB}/teams/${music.id}`);
    const row = page.locator("[data-event-date]").first();
    await row.getByTestId("calendar-planned").getByText(`Planned by Events web ${stamp}`).waitFor();
    await row.getByRole("button", { name: / actions$/ }).click();
    if (await page.getByTestId("calendar-toggle-date").count()) throw new Error("a date of the organisation's event can be cancelled from the team");
    await page.getByTestId("calendar-edit-event").click();
    await page.getByTestId("event-planned").waitFor();
    if (await page.getByTestId("event-dialog").getByLabel("Title").count()) throw new Error("its title can be changed from the team");
    await page.getByTestId("event-dialog").getByTestId("event-parts").waitFor();
    await page.keyboard.press("Escape");
  });

  await step("the host cancels the first date for every group", async () => {
    await page.context().clearCookies();
    await signIn(page, host);
    await page.goto(`${WEB}/organizations/${org.id}/events`);
    const row = page.locator("[data-org-event-date]").first();
    await row.getByRole("button", { name: / actions$/ }).click();
    await page.getByTestId("org-toggle-date").click();
    await row.getByText("Cancelled").waitFor();
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/organizations/settings");
}
finish();
