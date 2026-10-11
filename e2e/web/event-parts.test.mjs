// The parts an event needs, in the browser (issue #235, phase 7): an admin
// adds them in the event's dialog - an instrument, a role, a name of the
// team's own - the calendar shows the admins what's short, and Who can play
// lists them by part.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Parts web admin");
const drummer = await user("Parts web drummer");
sql(`update "User" set instruments='{DRUMS}' where id='${drummer.id}'`);
const team = await api(admin, "POST", "/teams", { name: `Parts web ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmpw${stamp}', '${team.id}', '${drummer.id}', 'MEMBER', now(), now())`);
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const first = plus(3);
const event = await api(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: first, startTime: "10:00", timeZone: "UTC" });
await api(drummer, "PUT", `/teams/${team.id}/events/${event.id}/dates/${first}/answer`, { answer: "AVAILABLE" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });
  const row = () => page.locator(`[data-event-date="${first}"]`).first();

  await step("the event's dialog: drums, sound engineer, and a name of the team's own", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await row().getByRole("button", { name: /actions$/ }).click();
    await page.getByTestId("calendar-edit-event").click();
    const parts = page.getByTestId("event-parts");
    await parts.getByTestId("event-part-add").selectOption("DRUMS");
    await parts.getByTestId("event-part-add").selectOption("SOUND_ENGINEER");
    await parts.getByTestId("event-part-add").selectOption("__other");
    await parts.getByTestId("event-part-name").fill("Slides");
    await parts.getByTestId("event-part-name-add").click();
    await parts.locator('[data-part="DRUMS"]').getByRole("spinbutton").fill("2");
    await page.getByRole("button", { name: "Save event" }).click();
    await page.getByTestId("event-dialog").waitFor({ state: "detached" });
    const saved = await api(admin, "GET", `/teams/${team.id}/events/${event.id}`);
    if (JSON.stringify(saved.parts) !== JSON.stringify([{ part: "DRUMS", count: 2 }, { part: "SOUND_ENGINEER", count: 1 }, { name: "Slides", count: 1 }])) throw new Error(JSON.stringify(saved.parts));
  });

  await step("the calendar shows what's short", async () => {
    await row().getByTestId("calendar-short").getByText("Short: Drums, Sound engineer").waitFor();
  });

  await step("Who can play, by part", async () => {
    await row().getByTestId("calendar-answers").click();
    const byPart = page.getByTestId("answers-by-part");
    await byPart.locator('[data-part="DRUMS"]').getByText("✓ Parts web drummer").waitFor();
    await byPart.locator('[data-part="SOUND_ENGINEER"]').getByText("No one available yet").waitFor();
  });
} finally {
  await browser.close();
}
finish();
