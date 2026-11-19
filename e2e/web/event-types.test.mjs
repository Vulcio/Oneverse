// Event types on a team's calendar (issue #523): the admin adds the
// suggested Service (Host, Speaker, Music leader, Media operator) and Meeting (no set), then
// a new event picked from Meeting is filled from it - its title, time and
// "Make a set for each date" off - and its date gets no set, nor a "Plan set".
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const shots = process.env.E2E_SHOTS;
const admin = await user("Eve Types");
const team = await api(admin, "POST", "/teams", { name: `Event types ${stamp}` });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", deviceScaleFactor: shots ? 2 : 1 });
  const calendar = page.getByTestId("team-calendar");

  await step("the admin adds the suggested types", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/teams/${team.id}`);
    await calendar.getByTestId("calendar-event-types").click();
    const dialog = page.getByTestId("event-types-dialog");
    await dialog.getByTestId("event-type-suggest-service").click();
    await dialog.locator('[data-event-type="Service"]').getByText("Host, Speaker, Music leader, Media operator").waitFor();
    await dialog.getByTestId("event-type-suggest-meeting").click();
    await dialog.locator('[data-event-type="Meeting"]').getByTestId("event-type-no-set").waitFor();
    if (shots) await dialog.screenshot({ path: `${shots}/event-types.png` });
  });

  await step("a type is edited: its parts", async () => {
    const dialog = page.getByTestId("event-types-dialog");
    await dialog.locator('[data-event-type="Service"]').getByTestId("event-type-edit").click();
    const editor = page.getByTestId("event-type-dialog");
    await editor.getByTestId("event-part-add").selectOption("DRUMS");
    await editor.getByTestId("event-type-save").click();
    await page.getByTestId("event-types-dialog").locator('[data-event-type="Service"]').getByText("Host, Speaker, Music leader, Media operator, Drums").waitFor();
    await page.keyboard.press("Escape");
    await page.getByTestId("event-types-dialog").waitFor({ state: "hidden" });
  });

  await step("a new event picked from Meeting is filled from it, without a set", async () => {
    await calendar.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByTestId("event-with-set").waitFor();
    if (!(await dialog.getByTestId("event-with-set").isChecked())) throw new Error("sets are off before a type is picked");
    await dialog.getByTestId("event-type").selectOption({ label: "Meeting" });
    if ((await dialog.getByLabel("Title").inputValue()) !== "Meeting") throw new Error("the title isn't the type's name");
    if ((await dialog.getByLabel("Start time").inputValue()) !== "19:00") throw new Error("the time isn't the type's");
    if (await dialog.getByTestId("event-with-set").isChecked()) throw new Error("a meeting still makes sets");
    if (shots) await dialog.screenshot({ path: `${shots}/event-from-type.png` });
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
    const row = calendar.locator("[data-event-date]").filter({ hasText: "Meeting" }).first();
    await row.waitFor();
    if (await row.getByTestId("calendar-open-set").count()) throw new Error("the meeting's date has a set");
    if (await row.getByTestId("calendar-plan-set").count()) throw new Error("the meeting's date offers to plan a set");
  });

  await step("a Service event asks for its host, speaker and music leader", async () => {
    await calendar.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByTestId("event-type").selectOption({ label: "Service" });
    await dialog.locator('[data-part="HOST"]').waitFor();
    await dialog.locator('[data-part="SPEAKER"]').waitFor();
    await dialog.locator('[data-part="MUSIC_LEADER"]').waitFor();
    if (!(await dialog.getByTestId("event-with-set").isChecked())) throw new Error("a service makes no set");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
    await calendar.locator("[data-event-date]").filter({ hasText: "Service" }).first().getByTestId("calendar-open-set").waitFor();
  });
} finally {
  await browser.close();
}
await finish();
