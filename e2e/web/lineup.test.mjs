// Scheduling by part in the browser (issue #235, phase 7): an admin opens a
// date's Line-up and puts a member on a part, those who play it listed
// first; the member sees "You're on Drums" on My calendar and accepts; the
// line-up shows on the team's calendar; the admin takes them off.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Lineup web admin");
const drummer = await user("Lineup web drummer");
sql(`update "User" set instruments='{DRUMS}' where id='${drummer.id}'`);
const team = await api(admin, "POST", "/teams", { name: `Lineup web ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmlw${stamp}', '${team.id}', '${drummer.id}', 'MEMBER', now(), now())`);
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const first = plus(3);
const event = await api(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: first, startTime: "10:00", timeZone: "UTC", parts: [{ part: "DRUMS", count: 1 }] });
await api(drummer, "PUT", `/teams/${team.id}/events/${event.id}/dates/${first}/answer`, { answer: "AVAILABLE" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });
  const row = () => page.locator(`[data-event-date="${first}"]`).first();

  await step("an admin puts the drummer on drums, from those who play it", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await row().getByTestId("calendar-lineup").click();
    const dialog = page.getByTestId("lineup-dialog");
    const drums = dialog.locator('[data-lineup-part="DRUMS"]');
    await drums.getByTestId("lineup-add").selectOption({ label: "Lineup web drummer · Available" });
    await drums.locator(`[data-place="${drummer.id}"][data-status="PENDING"]`).getByText("Asked").waitFor();
    await page.getByRole("button", { name: "Close" }).last().click();
    await row().locator('[data-lineup-part="DRUMS"]').getByText("Lineup web drummer").waitFor();
  });

  await step("the drummer accepts on My calendar", async () => {
    await page.context().clearCookies();
    await signIn(page, drummer);
    await page.goto(`${WEB}/calendar`);
    const date = page.locator(`[data-event-date="${first}"]`).first();
    await date.getByText("You're on Drums").waitFor();
    await date.getByTestId("lineup-accept").click();
    await date.locator('[data-my-place="ACCEPTED"]').waitFor();
  });

  await step("the admin sees it accepted, and takes them off", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await row().getByTestId("calendar-lineup").click();
    const place = page.getByTestId("lineup-dialog").locator(`[data-place="${drummer.id}"][data-status="ACCEPTED"]`);
    await place.waitFor();
    await place.getByTestId("lineup-remove").click();
    await page.getByTestId("lineup-dialog").getByText("No one yet").waitFor();
  });
} finally {
  await browser.close();
}
finish();
