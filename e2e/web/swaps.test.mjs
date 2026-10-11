// Swaps in the browser (issue #235, phase 7): the drummer on a date asks
// for a replacement on My calendar, with a note; another drummer sees the
// place offered on the team's calendar and takes it; the line-up shows them.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Swap web admin");
const alex = await user("Swap web alex");
const bea = await user("Swap web bea");
for (const who of [alex, bea]) sql(`update "User" set instruments='{DRUMS}' where id='${who.id}'`);
const team = await api(admin, "POST", "/teams", { name: `Swap web ${stamp}` });
[alex, bea].forEach((who, n) => sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmsw${n}${stamp}', '${team.id}', '${who.id}', 'MEMBER', now(), now())`));
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const first = plus(3);
const event = await api(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: first, startTime: "10:00", timeZone: "UTC", parts: [{ part: "DRUMS", count: 1 }] });
const place = await api(admin, "POST", `/teams/${team.id}/events/${event.id}/dates/${first}/lineup`, { userId: alex.id, part: "DRUMS" });
await api(alex, "PUT", `/teams/${team.id}/events/${event.id}/dates/${first}/lineup/${place.id}/response`, { status: "ACCEPTED" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });
  const row = () => page.locator(`[data-event-date="${first}"]`).first();

  await step("the drummer asks for a replacement, with a note", async () => {
    await signIn(page, alex);
    await page.goto(`${WEB}/calendar`);
    await row().getByTestId("lineup-swap-ask").click();
    await row().getByTestId("lineup-swap-note").fill("Flu, sorry");
    await row().getByTestId("lineup-swap-send").click();
    await row().getByTestId("lineup-swap-asked").waitFor();
  });

  await step("another drummer takes it from the team's calendar", async () => {
    await page.context().clearCookies();
    await signIn(page, bea);
    await page.goto(`${WEB}/teams/${team.id}`);
    await row().getByText('"Flu, sorry"').waitFor();
    await row().getByRole("button", { name: "Take Drums from Swap web alex" }).click();
    await row().getByText("You're on Drums").waitFor();
    await row().locator('[data-lineup-part="DRUMS"]').getByText("Swap web bea").waitFor();
  });
} finally {
  await browser.close();
}
finish();
