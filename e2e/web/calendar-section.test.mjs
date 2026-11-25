// Plan's Calendar section (issue #551): a picker of one's calendars - one's
// own, each organisation's and team's - a side menu (tabs on a phone) for
// the chosen one's dates, events, event types, calendar link and one's away
// days, those two a button away at the top too. Organisations get a calendar
// link of their own, made by their admins; a team's or organisation's link
// is seen by its members, who can't change it.
import { chromium } from "playwright";
import { ONEVERSE, PLANIVERSE, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Calendar section admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Calendar section alice");
const bob = await user("Calendar section bob");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(alice, "POST", "/organizations", { name: `Section org ${stamp}` });
const music = await api(alice, "POST", "/teams", { name: `Section music ${stamp}` });
await api(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmcs${stamp}', '${music.id}', '${bob.id}', 'MEMBER', now(), now())`);
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") select 'omcs${stamp}', '${org.id}', '${bob.id}', 'MEMBER', now(), now() where not exists (select 1 from "OrganizationMembership" where "organizationId"='${org.id}' and "userId"='${bob.id}')`);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
await api(alice, "POST", `/teams/${music.id}/events`, { title: `Rehearsal ${stamp}`, date: tomorrow, startTime: "19:00", timeZone: "UTC" });
// A group that only plans: its dates are in Plan, not on Songverse's My calendar.
const welcome = await api(alice, "POST", `/organizations/${org.id}/groups`, { name: `Section welcome ${stamp}` });
await api(alice, "POST", `/teams/${welcome.id}/events`, { title: `Door welcome ${stamp}`, date: tomorrow, startTime: "09:30", timeZone: "UTC" });
await api(alice, "POST", `/organizations/${org.id}/events`, { title: `Big service ${stamp}`, date: tomorrow, startTime: "10:00", timeZone: "UTC", hostUserId: alice.id, needs: [{ teamId: music.id }] });

async function signInHere(who) {
  await page.goto(PLANIVERSE);
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.fill("#signin-email", who.email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${PLANIVERSE}/calendar`);
}
const section = () => page.getByTestId("calendar-section");
// Picked again until it's shown: a pick before the page has hydrated is lost.
const pick = async (value) => {
  await page.waitForLoadState("networkidle");
  const picker = page.getByTestId("calendar-picker");
  for (let attempt = 0; ; attempt++) {
    const shown = await section().getAttribute("data-calendar");
    if (shown !== value) await picker.selectOption(shown);
    await picker.selectOption(value);
    try {
      await page.waitForFunction((of) => document.querySelector("[data-testid=calendar-section]")?.getAttribute("data-calendar") === of, value, { timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
};
const tabs = async () => (await page.locator("[data-testid^=calendar-tab-]").evaluateAll((all) => all.map((one) => one.dataset.testid.slice("calendar-tab-".length)))).join();

// The organisation's link, through the API: its admins make it, its members see it.
let r = await call(bob, "POST", `/organizations/${org.id}/calendar-feed`);
check("only the organisation's admins make its link", r.status === 403, String(r.status));
check("none until asked for", (await call(bob, "GET", `/organizations/${org.id}/calendar-feed`)).body.url === null);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });

  await step("my calendar first: its dates, no events or types of its own", async () => {
    await signInHere(alice);
    await section().waitFor();
    check("mine", (await section().getAttribute("data-calendar")) === "me");
    check("its tabs", (await tabs()) === "dates,subscribe,availability", await tabs());
    await page.locator("[data-event-date]", { hasText: `Rehearsal ${stamp}` }).first().waitFor();
    await page.locator("[data-event-date]", { hasText: `Door welcome ${stamp}` }).first().waitFor();
    const options = await page.getByTestId("calendar-picker").locator("option").allInnerTexts();
    check("the picker: mine, the organisation, the team", options[0] === "My calendar" && options.includes(`Section org ${stamp}`) && options.some((one) => one.startsWith(`Section music ${stamp}`)), options.join("|"));
  });

  await step("Availability, a button away: one's away days", async () => {
    await page.getByTestId("calendar-section-availability").click();
    await page.getByTestId("away-card").waitFor();
    check("in the address", new URL(page.url()).searchParams.get("tab") === "availability", page.url());
  });

  await step("a team's calendar: its dates, its events, its event types for its admin", async () => {
    await pick(`team:${music.id}`);
    check("kept on availability", (await section().getAttribute("data-tab")) === "availability");
    check("the team's tabs", (await tabs()) === "dates,events,types,subscribe,availability", await tabs());
    await page.getByTestId("calendar-tab-dates").click();
    await page.getByTestId("team-calendar").getByText(`Rehearsal ${stamp}`).first().waitFor();
    await page.getByTestId("calendar-tab-events").click();
    await page.getByTestId("calendar-new-event").waitFor();
    await page.getByTestId("calendar-tab-types").click();
    await page.getByTestId("event-types").getByTestId("event-type-new").click();
    await page.getByTestId("event-type-name").fill(`Midweek ${stamp}`);
    await page.getByTestId("event-type-save").click();
    await page.getByTestId("event-type-dialog").waitFor({ state: "hidden" });
    await page.getByTestId("event-types").getByText(`Midweek ${stamp}`).waitFor();
    check("saved", (await api(alice, "GET", `/teams/${music.id}/event-types`)).some((one) => one.name === `Midweek ${stamp}`));
  });

  await step("the team's page leads there", async () => {
    await page.goto(`${PLANIVERSE}/teams/${music.id}`);
    await page.getByTestId("team-open-calendar").click();
    await page.waitForURL(`${PLANIVERSE}/calendar?of=team%3A${music.id}`);
    await section().waitFor();
    check("the team's", (await section().getAttribute("data-calendar")) === `team:${music.id}`);
  });

  let feed;
  await step("an organisation's calendar: its events, and a calendar link its admin makes", async () => {
    await pick(`organization:${org.id}`);
    check("the title", (await page.getByTestId("calendar-section-title").innerText()) === `Section org ${stamp}`);
    await page.getByTestId("calendar-tab-events").click();
    await page.getByTestId("org-new-event").waitFor();
    await page.getByTestId("calendar-section-subscribe").click();
    const card = page.getByTestId("organization-calendar-feed");
    await card.getByTestId("calendar-feed-make").click();
    feed = await card.getByTestId("calendar-feed-url").inputValue();
    const ics = (await (await fetch(feed)).text()).replace(/\r\n /g, "");
    check("its events, named after it", ics.includes(`X-WR-CALNAME:Songverse - Section org ${stamp}`) && ics.includes(`SUMMARY:Big service ${stamp}\r\n`), ics.split("\r\n").filter((l) => /^(X-WR-CALNAME|SUMMARY)/.test(l)).slice(0, 4).join(" | "));
    check("once each, not once per group", ics.split(`SUMMARY:Big service ${stamp}\r\n`).length - 1 === 1);
    check("not the groups' own dates", !ics.includes(`Rehearsal ${stamp}`));
  });

  await step("a member: no event types, the links read only", async () => {
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" });
    await signInHere(bob);
    await pick(`organization:${org.id}`);
    check("no types", (await tabs()) === "dates,events,subscribe,availability", await tabs());
    await page.getByTestId("calendar-tab-subscribe").click();
    const card = page.getByTestId("organization-calendar-feed");
    check("the organisation's link", (await card.getByTestId("calendar-feed-url").inputValue()) === feed);
    check("not to reset or turn off", (await card.getByTestId("calendar-feed-off").count()) === 0 && (await card.getByRole("button", { name: "Reset link" }).count()) === 0);
    await pick(`team:${music.id}`);
    await page.getByTestId("team-calendar-feed").getByTestId("calendar-feed-none").waitFor();
    check("the tabs fit across a phone", (await page.getByTestId("calendar-tab-subscribe").boundingBox()).y < 400);
  });

  await step("Songverse: My calendar has the Songverse teams' dates; events are made in Plan", async () => {
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });
    await signIn(page, alice);
    await page.goto(`${WEB}/calendar`);
    await page.locator("[data-event-date]", { hasText: `Rehearsal ${stamp}` }).first().waitFor();
    check("not the group that only plans", (await page.locator("[data-event-date]", { hasText: `Door welcome ${stamp}` }).count()) === 0);
    await page.goto(`${WEB}/teams/${music.id}`);
    const calendar = page.getByTestId("team-calendar");
    const plan = calendar.getByTestId("calendar-manage-in-plan");
    check("Events in Plan", (await plan.getAttribute("href")) === `${PLANIVERSE}/calendar?of=${encodeURIComponent(`team:${music.id}`)}&tab=events`, await plan.getAttribute("href"));
    check("no New event or Event types here", (await calendar.getByTestId("calendar-new-event").count()) === 0 && (await calendar.getByTestId("calendar-event-types").count()) === 0);
    await calendar.getByTestId("calendar-ask").waitFor();
    await page.goto(`${WEB}/organizations/${org.id}/events`);
    await page.getByTestId("org-manage-in-plan").waitFor();
    check("no New event for the organisation", (await page.getByTestId("org-new-event").count()) === 0);
  });

  r = await call(alice, "DELETE", `/organizations/${org.id}/calendar-feed`);
  check("turned off", r.status === 204 && (await fetch(feed)).status === 404);
} finally {
  await browser.close();
}
finish();
