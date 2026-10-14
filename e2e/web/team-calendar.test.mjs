// A team's calendar on its page (issue #235): an admin adds a weekly
// event in a dialog; its coming dates show, each with its set ("Open
// set"); a date cancelled and restored; a date further out planned on
// demand; "Create sets ahead" saved; the event edited. A member sees the
// dates and opens a set, without the admin's tools.
import { chromium } from "playwright";
import { WEB, api, finish, pickDay, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Calendar admin");
const member = await user("Calendar member");
const team = await api(admin, "POST", "/teams", { name: `Calendar ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmw${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/Paris" });
  await signIn(page, admin);
  const calendar = () => page.getByTestId("team-calendar");
  const rows = () => calendar().locator("[data-event-date]");

  await step("an admin adds a weekly event: its dates show, the first ones with their sets", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    await calendar().getByText("No events yet", { exact: false }).waitFor();
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Morning service");
    await dialog.getByTestId("event-date").click();
    await pickDay(page.locator("[data-slot=calendar]").last(), tomorrow);
    if ((await dialog.getByTestId("event-date").getAttribute("data-value")) !== tomorrow) throw new Error("date not picked");
    await dialog.getByLabel("Start time").fill("10:00");
    await dialog.getByLabel("Repeats").selectOption("1");
    await dialog.getByLabel("Place (optional)").fill("Main hall");
    // A call time (issue #240): 45 minutes before.
    await dialog.getByLabel("Call time (minutes before)").fill("45");
    if ((await dialog.getByLabel("Time zone").inputValue()) !== "Europe/Paris") throw new Error("not the browser's time zone");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "detached" });
    await rows().nth(7).waitFor();
    if ((await rows().first().getAttribute("data-event-date")) !== tomorrow) throw new Error("not from tomorrow");
    await rows().first().getByText("10:00").waitFor();
    await rows().first().getByText("Main hall").waitFor();
    await rows().first().getByTestId("calendar-call").getByText("Call 09:15").waitFor();
    // 4 weeks of sets: the first dates open theirs, later ones are planned on demand.
    if ((await calendar().getByTestId("calendar-open-set").count()) < 4) throw new Error("no sets");
    await rows().nth(6).getByTestId("calendar-plan-set").waitFor();
  });

  await step("a date cancelled and restored", async () => {
    const second = rows().nth(1);
    await second.getByRole("button", { name: /actions$/ }).click();
    await page.getByTestId("calendar-toggle-date").click();
    await calendar().locator("[data-event-date][data-cancelled]").getByText("Cancelled").waitFor();
    await calendar().locator("[data-event-date][data-cancelled]").getByRole("button", { name: /actions$/ }).click();
    await page.getByRole("menuitem", { name: "Restore this date" }).click();
    await calendar().locator("[data-cancelled]").waitFor({ state: "detached" });
  });

  await step("a date further out: Plan the set opens a new set for it", async () => {
    const far = rows().nth(6);
    const date = await far.getAttribute("data-event-date");
    await far.getByTestId("calendar-plan-set").click();
    await page.waitForURL(/\/sets\/[^/]+$/);
    // Its name and date, in the reader's language: "Morning service - Nov 22".
    const day = new Date(`${date}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", ...(date.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: "numeric" }), timeZone: "UTC" });
    await page.getByRole("heading", { name: `Morning service - ${day}` }).first().waitFor();
    const setId = page.url().split("/").pop();
    if (sql(`select "eventDate"::text from "Setlist" where id = '${setId}'`) !== date) throw new Error("not the date's set");
  });

  await step("Create sets ahead: 13 weeks", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("calendar-sets-ahead").fill("13");
    await page.getByTestId("calendar-sets-ahead-save").click();
    await page.getByTestId("calendar-sets-ahead-save").getByText("Saved").waitFor();
    if (sql(`select "setsAheadWeeks" from "Team" where id = '${team.id}'`) !== "13") throw new Error("not saved");
    await calendar().getByTestId("calendar-plan-set").waitFor({ state: "detached" });
  });

  await step("the event edited: every other week, renamed", async () => {
    await rows().first().getByRole("button", { name: /actions$/ }).click();
    await page.getByTestId("calendar-edit-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Sunday service");
    await dialog.getByLabel("Repeats").selectOption("2");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "detached" });
    await rows().first().getByText("Sunday service").waitFor();
    const [a, b] = await Promise.all([rows().nth(0).getAttribute("data-event-date"), rows().nth(1).getAttribute("data-event-date")]);
    if ((Date.parse(b) - Date.parse(a)) / 86400000 !== 14) throw new Error(`${a} ${b}`);
  });

  await step("a member sees the dates and opens a set, without the admin's tools", async () => {
    await page.context().clearCookies();
    await signIn(page, member);
    await page.goto(`${WEB}/teams/${team.id}`);
    await rows().first().getByText("Sunday service").waitFor();
    if (await page.getByTestId("calendar-new-event").count()) throw new Error("a member can add events");
    if (await calendar().getByRole("button", { name: /actions$/ }).count()) throw new Error("a member has date actions");
    if (await page.getByTestId("calendar-sets-ahead").count()) throw new Error("a member has the setting");
    await calendar().getByTestId("calendar-open-set").first().click();
    await page.waitForURL(/\/sets\/[^/]+$/);
  });
} finally {
  await browser.close();
}
finish();
