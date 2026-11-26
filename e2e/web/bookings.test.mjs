// Bookings in Plan (issue #565): a room whose bookings the Facilities team approves; a group's event asks for it and
// waits; the Facilities admin approves it from "Bookings to approve" on their team's page; the venue's "Bookings"
// show it; another group clashing with it is told who holds the room and asks them.
import { chromium } from "playwright";
import { PLANIVERSE, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("Bookings web global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const lead = await user("Bookings web lead");
const keeper = await user("Bookings web facilities");
const youthLead = await user("Bookings web youth");
const org = await api(lead, "POST", "/organizations", { name: `Bookings church ${stamp}` });
const facilities = await api(lead, "POST", "/teams", { name: `Facilities ${stamp}` });
const youth = await api(lead, "POST", "/teams", { name: `Youth ${stamp}` });
for (const [who, team] of [[keeper, facilities], [youthLead, youth]]) {
  await api(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
  await api(who, "POST", `/teams/join/${(await api(lead, "POST", `/teams/${team.id}/invite-links`, { role: "ADMIN" })).token}`);
  sql(`update "TeamMembership" set role='MEMBER' where "teamId"='${team.id}' and "userId"='${lead.id}'`);
}
const campus = await api(lead, "POST", "/locations", { name: "Campus", timeZone: "Europe/Paris", organizationId: org.id });
const day = plus(9);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/Paris" });

  await step("an organisation admin adds a room the Facilities team approves", async () => {
    await signIn(page, lead);
    await page.goto(`${PLANIVERSE}/organizations/${org.id}`);
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId("locations-card");
    await card.getByTestId("room-add").click();
    const form = card.getByTestId("room-form");
    await form.getByTestId("room-name").fill("Main hall");
    await form.getByTestId("needs-approval").check();
    await form.getByTestId("approval-team").selectOption({ label: `Facilities ${stamp}'s admins` });
    await form.getByTestId("room-save").click();
    await card.locator('[data-testid="location-room"][data-room="Main hall"]').getByTestId("room-approval").getByText(`Facilities ${stamp}'s admins`).waitFor();
  });

  const hall = (await api(lead, "GET", `/locations/${campus.id}`)).rooms[0];
  const night = await api(youthLead, "POST", `/teams/${youth.id}/events`, { title: "Youth night", date: day, startTime: "19:00", timeZone: "Europe/Paris", locationId: campus.id, roomIds: [hall.id] });
  if (night.awaitingApproval?.join() !== "Main hall") throw new Error(`not waiting: ${JSON.stringify(night)}`);

  await step("the Facilities admin approves it from their team's page", async () => {
    await page.context().clearCookies();
    await signIn(page, keeper);
    await page.goto(`${PLANIVERSE}/teams/${facilities.id}`);
    await page.waitForLoadState("networkidle");
    const request = page.getByTestId("booking-requests").locator('[data-testid="booking-request"][data-what="Main hall"]');
    await request.getByText(`Youth night (Youth ${stamp})`).waitFor();
    await request.getByTestId("booking-approve").click();
    await page.getByTestId("booking-requests").waitFor({ state: "detached" });
    const after = await api(youthLead, "GET", `/teams/${youth.id}/events/${night.id}`);
    if (after.awaitingApproval.length) throw new Error(`still waiting: ${JSON.stringify(after)}`);
  });

  await step("the venue's Bookings show it", async () => {
    await page.context().clearCookies();
    await signIn(page, lead);
    await page.goto(`${PLANIVERSE}/organizations/${org.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("locations-card").getByTestId("bookings-open").click();
    const dialog = page.getByTestId("bookings-dialog");
    await dialog.getByTestId("booking-row").filter({ hasText: "Youth night" }).filter({ hasText: `Youth ${stamp}` }).waitFor();
    await page.keyboard.press("Escape");
  });

  await step("another group clashing with it is told who holds the room, and asks them", async () => {
    // The Facilities team's own clean-up, the morning: moved onto the youth night in its dialog.
    await api(keeper, "POST", `/teams/${facilities.id}/events`, { title: "Deep clean", date: day, startTime: "08:00", timeZone: "Europe/Paris", locationId: campus.id, roomIds: [hall.id] });
    await page.context().clearCookies();
    await signIn(page, keeper);
    await page.goto(`${PLANIVERSE}/teams/${facilities.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("team-calendar").locator("[data-event-date]").first().getByRole("button", { name: /actions$/ }).click();
    await page.getByTestId("calendar-edit-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Start time").fill("19:30");
    await dialog.getByRole("button", { name: "Save event" }).click();
    const clashes = dialog.getByTestId("booking-clashes");
    await clashes.getByTestId("booking-clash").filter({ hasText: `Youth night (Youth ${stamp})` }).waitFor();
    await clashes.getByTestId("booking-ask").click();
    await clashes.getByTestId("booking-ask-form").getByRole("textbox").fill("Could we have the hall at 19:30?");
    await clashes.getByTestId("booking-ask-send").click();
    await clashes.getByTestId("booking-asked").waitFor();
    const told = (await api(youthLead, "GET", "/users/me/notifications?limit=50")).items.find((one) => one.kind === "BOOKING_ASKED");
    if (told?.data.note !== "Could we have the hall at 19:30?") throw new Error(`not told: ${JSON.stringify(told)}`);
  });
} finally {
  await browser.close();
}
finish();
