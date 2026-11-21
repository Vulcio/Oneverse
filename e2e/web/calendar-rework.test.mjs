// The calendar reworked (issue #549), in the browser: a team's calendar lists
// its events once (Events) to change a series as a whole, and a date on its
// own (Edit this date); a group says which roles it fills, and a role added
// to an event is open to it ("Music · Worship"); the date's music lead asks
// for instruments on its set; a team's event is moved to the organisation,
// whose page opens on its calendar, and accepted there.
import { chromium } from "playwright";
import { WEB, api, call, finish, sql, stamp, stepper, signIn, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const shots = process.env.E2E_SHOTS;
const admin = await user("Rework Admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Rework Planner");
const lead = await user("Rework Lead");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const date = plus(3);

await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(planner, "POST", "/organizations", { name: `Rework church ${stamp}` });
const sunday = await api(planner, "POST", `/organizations/${org.id}/groups`, { name: `Sunday ${stamp}`, usesSongverse: true });
const worship = await api(planner, "POST", `/organizations/${org.id}/groups`, { name: `Worship ${stamp}`, usesSongverse: true });
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omwrw${stamp}', '${org.id}', '${lead.id}', 'MEMBER', now(), now())`);
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmwrw${stamp}', '${worship.id}', '${lead.id}', 'MEMBER', now(), now())`);
const event = await api(planner, "POST", `/teams/${sunday.id}/events`, { title: "Sunday service", date, startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 } });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", deviceScaleFactor: shots ? 2 : 1 });
  const calendar = page.getByTestId("team-calendar");
  const row = (on) => calendar.locator(`[data-event-date="${on}"]`).first();

  await step("Worship says it fills Music, on its page", async () => {
    await signIn(page, planner);
    await page.goto(`${WEB}/teams/${worship.id}`);
    const card = page.getByTestId("team-group-card");
    await card.locator('[data-fills="MUSIC_LEADER"]').check();
    if (shots) await card.screenshot({ path: `${shots}/group-fills.png` });
    await card.getByTestId("team-group-save").click();
    await page.waitForResponse((response) => response.url().endsWith(`/teams/${worship.id}/group`) && response.ok());
  });

  await step("the series, from Events: Music added is open to Worship", async () => {
    await page.goto(`${WEB}/teams/${sunday.id}`);
    await calendar.getByTestId("calendar-view-events").click();
    const series = calendar.locator(`[data-series="${event.id}"]`);
    await series.getByText(/Every week · \w+ 10:00/).waitFor();
    if (shots) await calendar.screenshot({ path: `${shots}/calendar-events.png` });
    await series.getByTestId("series-edit").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByTestId("event-part-add").selectOption("MUSIC_LEADER");
    if ((await dialog.getByTestId("event-part-add").locator('option[value="DRUMS"]').count()) > 0) throw new Error("an event still offers instruments");
    await dialog.locator('[data-part="MUSIC_LEADER"]').getByText(`Music · Worship ${stamp}`).waitFor();
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
    await series.getByText(`Music · Worship ${stamp}`).waitFor();
  });

  await step("one date changed on its own, from its menu", async () => {
    await calendar.getByTestId("calendar-view-dates").click();
    await row(date).getByRole("button", { name: /actions/ }).click();
    await page.getByTestId("calendar-edit-date").click();
    const dialog = page.getByTestId("date-dialog");
    await dialog.getByTestId("date-title").fill("Easter service");
    await dialog.getByTestId("date-start").fill("09:30");
    await dialog.getByTestId("date-save").click();
    await dialog.waitFor({ state: "hidden" });
    await row(date).getByText("Easter service").waitFor();
    await row(date).getByTestId("calendar-date-changed").waitFor();
    await row(plus(10)).getByText("Sunday service").waitFor();
    if (shots) await calendar.screenshot({ path: `${shots}/calendar-dates.png` });
  });

  await step("the music lead asks for drums on the date's set", async () => {
    const { setlistId } = await api(planner, "POST", `/teams/${sunday.id}/events/${event.id}/dates/${date}/set`);
    await api(lead, "POST", "/users/me/open-places", { teamId: sunday.id, eventId: event.id, date, part: "MUSIC_LEADER" });
    await page.context().clearCookies();
    await signIn(page, lead);
    await page.goto(`${WEB}/sets/${setlistId}`);
    const asks = page.getByTestId("date-asks");
    await asks.getByTestId("date-asks-edit").click();
    await asks.getByTestId("event-part-add").selectOption("DRUMS");
    await asks.getByTestId("date-asks-save").click();
    await asks.locator('[data-ask="DRUMS"]').getByText("0/1").waitFor();
    if (shots) await asks.screenshot({ path: `${shots}/set-asks.png` });
  });

  await step("the series moved to the organisation, then accepted on its calendar", async () => {
    await page.context().clearCookies();
    await signIn(page, planner);
    await page.goto(`${WEB}/teams/${sunday.id}`);
    await calendar.getByTestId("calendar-view-events").click();
    await calendar.locator(`[data-series="${event.id}"]`).getByTestId("series-edit").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByTestId("event-transfer-ask").click();
    await dialog.waitFor({ state: "hidden" });
    await calendar.getByTestId("series-transfer-waiting").waitFor();
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.getByTestId("organization-calendar").waitFor();
    await page.getByTestId("organization-calendar-open").click();
    const transfers = page.getByTestId("org-transfers");
    await transfers.locator(`[data-transfer="${event.id}"]`).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/organization-transfers.png` });
    await transfers.getByTestId("org-transfer-accept").click();
    await transfers.waitFor({ state: "hidden" });
    await page.locator(`[data-org-event-date="${plus(10)}"]`).getByText("Sunday service").waitFor();
    await page.getByTestId("org-view-events").click();
    await page.getByTestId("org-series").getByText(/Every week/).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/organization-series.png` });
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.getByTestId("organization-calendar").locator(`[data-coming-date="${plus(10)}"]`).waitFor();
    if (shots) await page.getByTestId("organization-calendar").screenshot({ path: `${shots}/organization-page.png` });
  });
} finally {
  await browser.close();
  await call(admin, "DELETE", "/admin/organizations/settings");
}
await finish();
