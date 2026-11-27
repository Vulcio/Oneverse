// Planiverse (issue #241): the planning on its own, with the same account
// as Songverse. Signed out, its sign-in page; signed in, My calendar with a
// Songverse team's set opening as its running order in the Oneverse app (issue #521); an organisation, a group that
// only plans and a Songverse team, whose sets open there too (a group
// that only plans has them too, issue #531); joining
// an organisation by its link; signing out.
import { chromium } from "playwright";
import { LOG, ONEVERSE, PLANIVERSE, api, finish, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { readFileSync } from "node:fs";

let page;
const step = stepper(() => page);
const admin = await user("Planiverse admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Planiverse alice");
const bob = await user("Planiverse bob");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(alice, "POST", "/organizations", { name: `Planiverse org ${stamp}` });
const music = await api(alice, "POST", "/teams", { name: `Music ${stamp}` });
await api(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
const welcome = await api(alice, "POST", `/organizations/${org.id}/groups`, { name: `Welcome ${stamp}` });
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const service = await api(alice, "POST", `/teams/${music.id}/events`, { title: "Sunday service", date: tomorrow, startTime: "10:00", timeZone: "UTC" });
const { setlistId } = await api(alice, "POST", `/teams/${music.id}/events/${service.id}/dates/${tomorrow}/set`);
await api(alice, "POST", `/teams/${welcome.id}/events`, { title: "Door welcome", date: tomorrow, startTime: "09:30", timeZone: "UTC" });
// Its notices, read out: a set, though the group only plans (issue #531), beyond the sets made ahead (4 weeks), so none is there yet.
const later = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const notices = await api(alice, "POST", `/teams/${welcome.id}/events`, { title: "Notices", date: later, startTime: "09:00", timeZone: "UTC", withSet: true });
const { token } = await api(alice, "POST", `/organizations/${org.id}/invite-links`, {});
// Bob, in a group (and so its organisation's member later, by its link): his Teams page lists it.
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmpv${stamp}', '${welcome.id}', '${bob.id}', 'MEMBER', now(), now())`);
// …and in a group under it: listed under it (issue #246).
const parking = await api(alice, "POST", `/organizations/${org.id}/groups`, { name: `Parking ${stamp}`, parentId: welcome.id });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmpvp${stamp}', '${parking.id}', '${bob.id}', 'MEMBER', now(), now())`);

async function signInHere(who) {
  // At Oneverse (issue #303), and back.
  await page.goto(PLANIVERSE);
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.fill("#signin-email", who.email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${PLANIVERSE}/calendar`);
}

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });

  await step("signed out: off to sign in at Oneverse (issue #303), to come back to the calendar", async () => {
    await page.goto(`${PLANIVERSE}/calendar`);
    await page.waitForURL(`${ONEVERSE}/sign-in**`);
    if (!decodeURIComponent(page.url()).includes(`redirect_uri=${PLANIVERSE}/auth/callback`)) throw new Error(page.url());
    await page.locator("#signin-email").waitFor();
  });

  await step("signed in with the Songverse account: My calendar, the set opening in the Oneverse app", async () => {
    await signInHere(alice);
    const row = page.locator("[data-event-date]", { hasText: "Sunday service" }).first();
    await row.waitFor();
    const href = await row.getByRole("link", { name: /Open set/ }).getAttribute("href");
    if (href !== `${ONEVERSE}/sets/${setlistId}`) throw new Error(`the set opens at ${href}`);
    await page.locator("[data-event-date]", { hasText: "Door welcome" }).first().waitFor();
  });

  await step("the organisation, its groups, a group's page in Planiverse", async () => {
    await page.getByTestId("nav-organizations").click();
    await page.waitForURL(`${PLANIVERSE}/organizations`);
    await page.getByRole("link", { name: `Planiverse org ${stamp}` }).click();
    await page.waitForURL(`${PLANIVERSE}/organizations/${org.id}`);
    await page.getByRole("link", { name: `Welcome ${stamp}` }).click();
    await page.waitForURL(`${PLANIVERSE}/teams/${welcome.id}`);
    await page.getByTestId("team-calendar").getByText("Door welcome").first().waitFor();
  });

  await step("a Songverse team's calendar: its set opens in the Oneverse app", async () => {
    await page.goto(`${PLANIVERSE}/teams/${music.id}`);
    const calendar = page.getByTestId("team-calendar");
    const open = calendar.getByTestId("calendar-open-set").first();
    if ((await open.getAttribute("href")) !== `${ONEVERSE}/sets/${setlistId}`) throw new Error(`the set opens at ${await open.getAttribute("href")}`);
  });

  await step("a group that only plans: its event's set planned from here, opening in the Oneverse app (issues #531, #521)", async () => {
    await page.goto(`${PLANIVERSE}/teams/${welcome.id}`);
    const calendar = page.getByTestId("team-calendar");
    const row = calendar.locator(`[data-event-id="${notices.id}"]`).first();
    await row.getByTestId("calendar-plan-set").click();
    await page.waitForURL(`${ONEVERSE}/sets/**`);
    const made = (await api(alice, "GET", `/teams/${welcome.id}/event-dates?from=${later}&to=${later}`))[0];
    if (!made?.setlistId || !page.url().endsWith(`/sets/${made.setlistId}`)) throw new Error(`the set: ${JSON.stringify(made)} at ${page.url()}`);
    // A notification's address in Planiverse (its emails) goes there too.
    await page.goto(`${PLANIVERSE}/sets/${made.setlistId}`);
    await page.waitForURL(`${ONEVERSE}/sets/${made.setlistId}`);
    await page.goto(`${PLANIVERSE}/organizations/${org.id}/events`);
    await page.getByTestId("org-new-event").waitFor();
  });

  await step("someone joins the organisation by its link, in Planiverse", async () => {
    await page.context().clearCookies();
    await signInHere(bob);
    await page.goto(`${PLANIVERSE}/join-organization/${token}`);
    await page.waitForURL(`${PLANIVERSE}/organizations/${org.id}`);
    const mine = await api(bob, "GET", "/organizations");
    if (!mine.organizations.some((one) => one.id === org.id)) throw new Error("not in the organisation");
  });

  await step("the menu: Teams, every one of theirs, sub-groups under their group; Settings, here", async () => {
    await page.getByTestId("nav-teams").click();
    await page.getByTestId("teams-list").getByText(`Welcome ${stamp}`).waitFor();
    await page.getByTestId("teams-list").locator('[data-depth="1"]', { hasText: `Parking ${stamp}` }).waitFor();
    await page.getByTestId("user-menu").click();
    await page.getByTestId("nav-account").click();
    await page.waitForURL(`${PLANIVERSE}/settings/account`);
    await page.getByLabel("First name").waitFor();
    // Oneverse Plan's own settings are here; Songverse's open in Songverse (issue #540).
    await page.getByTestId("settings-tab-plan").click();
    await page.waitForURL(`${PLANIVERSE}/settings/plan`);
    await page.getByTestId("plan-settings").getByTestId("week-start").waitFor();
    await page.getByTestId("notification-bell").waitFor();
  });

  await step("signs out from the menu", async () => {
    await page.getByTestId("user-menu").click();
    await page.getByTestId("sign-out").click();
    // Out of Planiverse and Oneverse: back at Oneverse's sign-in.
    await page.waitForURL(`${ONEVERSE}/sign-in**`);
    await page.goto(`${PLANIVERSE}/calendar`);
    await page.waitForURL(`${ONEVERSE}/sign-in**`);
  });
  await step("signing up from Planiverse: the email's link comes back to it, through the provider", async () => {
    await page.context().clearCookies();
    await page.goto(PLANIVERSE);
    await page.waitForURL(`${ONEVERSE}/sign-in**`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Sign up" }).click();
    const email = `e2e-planiverse-new-${stamp}@example.com`;
    await page.fill("#signup-name", "New planner");
    await page.fill("#signup-email", email);
    await page.fill("#signup-password", "hunter2pass");
    await page.getByRole("button", { name: "Create account" }).click();
    const sent = async () => readFileSync(LOG, "utf8").split("To: ").find((mail) => mail.startsWith(email)) ?? "";
    for (let i = 0; i < 40 && !(await sent()); i++) await new Promise((resolve) => setTimeout(resolve, 250));
    const link = /http\S+verify-email\S+/.exec(await sent())?.[0] ?? "";
    const callback = new URL(new URL(link.replace(/&amp;/g, "&")).searchParams.get("callbackURL") ?? "");
    if (callback.pathname !== "/api/auth/oauth2/authorize" || !callback.searchParams.get("redirect_uri")?.startsWith(`${PLANIVERSE}/auth/callback`)) throw new Error(`the link: ${link}`);
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/organizations/settings");
}
finish();
