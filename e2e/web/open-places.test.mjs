// Required parts and open places on a team's calendar (issue #528): the
// admin marks a new event's Host and Music leader required and opens the
// music leader's place to the team's members. A member sees what's missing,
// takes the music leader's place themselves, and gives it up again.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const shots = process.env.E2E_SHOTS;
const admin = await user("Opal Admin");
const member = await user("Opal Member");
const team = await api(admin, "POST", "/teams", { name: `Open places ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmwop${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", deviceScaleFactor: shots ? 2 : 1 });
  let calendar = page.getByTestId("team-calendar");

  await step("the admin makes an event: Host and Music leader required, the music leader's place open", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await calendar.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Sunday");
    await dialog.getByTestId("event-part-add").selectOption("HOST");
    await dialog.getByTestId("event-part-add").selectOption("MUSIC_LEADER");
    const host = dialog.locator('[data-part="HOST"]');
    if (await host.getByTestId("event-part-open").count()) throw new Error("Host can be opened");
    await host.getByTestId("event-part-required").check();
    const leader = dialog.locator('[data-part="MUSIC_LEADER"]');
    await leader.getByTestId("event-part-required").check();
    await leader.getByTestId("event-part-open").check();
    if (shots) await dialog.screenshot({ path: `${shots}/required-open-parts.png` });
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
    await calendar.locator("[data-event-date]").filter({ hasText: "Sunday" }).first().getByTestId("lineup-missing").getByText("Missing: Host, Music").waitFor();
  });

  await step("a member takes the music leader's place, then gives it up", async () => {
    await page.context().clearCookies();
    await signIn(page, member);
    await page.goto(`${WEB}/teams/${team.id}`);
    calendar = page.getByTestId("team-calendar");
    const row = calendar.locator("[data-event-date]").filter({ hasText: "Sunday" }).first();
    await row.getByTestId("lineup-missing").waitFor();
    if (shots) await row.screenshot({ path: `${shots}/open-place.png` });
    await row.getByTestId("lineup-volunteer").getByText("I'll do it: Music").click();
    await row.getByTestId("lineup-missing").getByText("Missing: Host").waitFor();
    await row.locator('[data-my-place="ACCEPTED"]').getByText("You're on Music").waitFor();
    if (await row.getByTestId("lineup-volunteer").count()) throw new Error("the place is still offered");
    await row.getByTestId("lineup-give-up").click();
    await row.getByTestId("lineup-volunteer").waitFor();
    await row.getByTestId("lineup-missing").getByText("Missing: Host, Music").waitFor();
  });
} finally {
  await browser.close();
}
await finish();
