// One event date's page (issue #575), the same in Songverse, Plan and
// Oneverse's home: a notification about a date opens it in each, and the
// date's title on My calendar and the home's next dates leads there. It
// shows when and where, one's answer, the line-up, the rehearsal and the
// set; the team's admins edit the line-up from it.
import { chromium } from "playwright";
import { ONEVERSE, PLANIVERSE, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Datepage admin");
const drummer = await user("Datepage drummer");
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const team = await api(admin, "POST", "/teams", { name: `Datepage band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmdp${stamp}', '${team.id}', '${drummer.id}', 'MEMBER', now(), now())`);
const date = plus(4);
const sunday = await api(admin, "POST", `/teams/${team.id}/events`, { title: `Sunday ${stamp}`, date, startTime: "10:00", timeZone: "UTC", place: "Main hall", parts: [{ part: "DRUMS", count: 1 }] });
await api(admin, "POST", `/teams/${team.id}/events`, { title: `Practice ${stamp}`, date: plus(2), startTime: "19:00", timeZone: "UTC", rehearsalFor: { eventId: sunday.id, daysBefore: 2 } });
await api(admin, "POST", `/teams/${team.id}/events/${sunday.id}/dates/${date}/lineup`, { userId: drummer.id, part: "DRUMS" });
const path = `/events/${sunday.id}/${date}`;

async function opensFromNotification(app) {
  await page.goto(`${app}/notifications`);
  await page.locator("[data-notification=SCHEDULED]").first().getByRole("button").first().click();
  await page.waitForURL(`${app}${path}`);
  await page.getByTestId("event-date-title").filter({ hasText: `Sunday ${stamp}` }).waitFor();
}

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });

  await step("Songverse: the notification opens the date's page", async () => {
    await signIn(page, drummer);
    await opensFromNotification(WEB);
    const shown = await page.getByTestId("event-date-page").innerText();
    check("when, where and the team", shown.includes("Main hall") && shown.includes(team.name), shown.slice(0, 300));
    check("its rehearsal", (await page.getByTestId("event-date-rehearsals").innerText()).includes(`Practice ${stamp}`));
    check("its set", (await page.getByTestId("event-date-open-set").count()) === 1);
  });

  await step("the drummer accepts their place there", async () => {
    await page.getByTestId("event-date-lineup").getByTestId("lineup-accept").click();
    await page.locator("[data-my-place=ACCEPTED]").waitFor();
    check("accepted", sql(`select status from "TeamEventAssignment" where "userId"='${drummer.id}'`) === "ACCEPTED");
  });

  await step("My calendar: the date's title leads to its page", async () => {
    await page.goto(`${WEB}/calendar`);
    await page.locator(`[data-event-id="${sunday.id}"]`).getByTestId("event-date-link").click();
    await page.waitForURL(`${WEB}${path}`);
  });

  await step("Plan: the notification opens the same page", async () => {
    await page.goto(PLANIVERSE);
    await page.waitForURL(`${PLANIVERSE}/calendar`);
    await opensFromNotification(PLANIVERSE);
  });

  await step("Oneverse's home: the next date leads to its page there", async () => {
    await page.goto(ONEVERSE);
    await page.getByTestId("home").waitFor();
    await page.getByTestId("home-dates").locator(`[data-event-id="${sunday.id}"]`).getByTestId("event-date-link").click();
    await page.waitForURL(`${ONEVERSE}${path}`);
    await page.getByTestId("event-date-title").filter({ hasText: `Sunday ${stamp}` }).waitFor();
    // Its set opens in Songverse.
    check("its set in Songverse", ((await page.getByTestId("event-date-open-set").getAttribute("href")) ?? "").startsWith(`${WEB}/sets/`));
  });

  await step("a date that isn't on one's calendar says so", async () => {
    await page.goto(`${ONEVERSE}/events/${sunday.id}/${plus(5)}`);
    await page.getByTestId("event-date-missing").waitFor();
  });

  await step("the team's admin edits the line-up from the page", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}${path}`);
    await page.getByTestId("event-date-edit-lineup").click();
    await page.getByRole("dialog").waitFor();
    check("the line-up's dialog, with the drummer", (await page.getByRole("dialog").innerText()).includes("Datepage drummer"));
    await page.keyboard.press("Escape");
    check("and the team's calendar from there", (await page.getByTestId("event-date-team-calendar").getAttribute("href")) === `/teams/${team.id}`);
  });
} finally {
  await browser.close();
}
finish();
