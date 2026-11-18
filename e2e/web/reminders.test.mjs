// Reminders in the browser (issue #235): an admin asks for answers by a
// deadline from the team's calendar - members see what's asked, by when -
// tells the people signed up for a date that its set is ready (the date
// then shows it), and runs the reminders now from Admin > Background jobs.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Rem web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const member = await user("Rem web member");
const team = await api(admin, "POST", "/teams", { name: `Rem web ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmw${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const first = plus(3);
const event = await api(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: first, startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 } });
await api(member, "PUT", `/teams/${team.id}/events/${event.id}/dates/${first}/answer`, { answer: "AVAILABLE" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });
  const row = (date) => page.locator(`[data-event-date="${date}"]`).first();

  await step("Ask for answers: the member missing some is asked; the request shows", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("calendar-ask").click();
    await page.getByTestId("ask-dialog").waitFor();
    await page.getByTestId("ask-send").click();
    await page.getByText("Asked 1 person.").waitFor();
    await page.getByTestId("calendar-request").getByText("Answers wanted by").waitFor();
  });

  await step("Tell them the set is ready: told, and the date shows it", async () => {
    await row(first).getByRole("button", { name: /actions$/ }).click();
    await page.getByTestId("calendar-set-ready-send").click();
    await page.getByText("Told 1 person the set is ready.").waitFor();
    await row(first).getByTestId("calendar-set-ready").waitFor();
    await row(first).getByRole("button", { name: /actions$/ }).click();
    await page.getByTestId("calendar-set-ready-send").getByText("Tell them again").waitFor();
    await page.keyboard.press("Escape");
  });

  await step("Admin > Background jobs: the calendar reminders run now", async () => {
    await page.goto(`${WEB}/admin/server`);
    await page.getByTestId("run-event-reminders").click();
    await page.getByText("Queued: Calendar reminders").waitFor();
  });

  await step("the member sees what's asked, and the bell has both", async () => {
    await page.context().clearCookies();
    await signIn(page, member);
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("calendar-request").waitFor();
    if (await page.getByTestId("calendar-request-remove").count()) throw new Error("only admins stop asking");
    await row(first).getByTestId("calendar-set-ready").waitFor();
    await page.getByTestId("notification-bell").click();
    await page.getByTestId("notification-list").getByText("The set for Morning service on").waitFor();
    await page.getByTestId("notification-list").getByText(`${team.name} asks when you can play`).waitFor();
  });

  await step("an admin stops asking", async () => {
    await page.keyboard.press("Escape");
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("calendar-request-remove").click();
    await page.getByTestId("calendar-request").waitFor({ state: "detached" });
  });
} finally {
  await browser.close();
}
finish();
