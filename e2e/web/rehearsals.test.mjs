// Rehearsals in the browser (issue #235, phase 7): an admin adds an event
// as the "Rehearsal for" another, days before; the team's calendar shows it
// with its badge and the date it's for, opening that date's set, with no
// answers of its own; a member signed up for the date sees it on My calendar.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Rehearsal web admin");
const singer = await user("Rehearsal web singer");
const team = await api(admin, "POST", "/teams", { name: `Rehearsal web ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmrw${stamp}', '${team.id}', '${singer.id}', 'MEMBER', now(), now())`);
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sunday = plus(5);
const practiceDay = plus(3);
const event = await api(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: sunday, startTime: "10:00", timeZone: "UTC" });
await api(singer, "PUT", `/teams/${team.id}/events/${event.id}/dates/${sunday}/answer`, { answer: "AVAILABLE" });
await api(admin, "POST", `/teams/${team.id}/events/${event.id}/dates/${sunday}/set`);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });

  await step("an admin adds a rehearsal for the service, 2 days before", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Band practice");
    await dialog.getByLabel("Rehearsal for").selectOption({ label: "Morning service" });
    await dialog.getByLabel("Days before").fill("2");
    if (await dialog.getByLabel("Repeats").count()) throw new Error("a rehearsal follows its event: no repeat of its own");
    await dialog.getByLabel("Start time").fill("19:00");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
  });

  await step("the calendar: its badge, the date it's for, that date's set, no answers", async () => {
    const row = page.locator(`[data-event-date="${practiceDay}"]`).filter({ hasText: "Band practice" });
    await row.getByTestId("calendar-rehearsal").waitFor();
    await row.getByTestId("calendar-rehearsal-of").getByText("Morning service").waitFor();
    await row.getByTestId("calendar-open-set").waitFor();
    if (await row.getByRole("group", { name: "Your answer" }).count()) throw new Error("a rehearsal takes no answers");
  });

  await step("a member signed up for the service sees it on My calendar", async () => {
    await page.context().clearCookies();
    await signIn(page, singer);
    await page.goto(`${WEB}/calendar`);
    const row = page.locator(`[data-event-date="${practiceDay}"]`).filter({ hasText: "Band practice" });
    await row.getByTestId("calendar-rehearsal").waitFor();
    await row.getByRole("link", { name: /Open set/ }).waitFor();
  });
} finally {
  await browser.close();
}
finish();
