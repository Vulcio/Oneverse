// Locations (issue #320) in the app: a team's admin adds one on the team's page, with its address and time zone;
// a new event picks it, which fills its place and time zone, and its date shows the place. Edited, then removed:
// the event keeps its place.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Locations web admin");
const team = await api(admin, "POST", "/teams", { name: `Locations ${stamp}` });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/Paris" });
  await signIn(page, admin);
  const card = () => page.getByTestId("locations-card");

  await step("an admin adds a location on the team's page", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    await card().getByText("No locations yet.").waitFor();
    await card().getByTestId("location-add").click();
    const form = card().getByTestId("location-form");
    await form.getByLabel("Name").fill("Riverside church");
    await form.getByLabel("Address (optional)").fill("2 Quay Road");
    await form.getByLabel("Time zone").selectOption("America/New_York");
    await form.getByRole("button", { name: "Save" }).click();
    await card().getByTestId("location-row").getByText("Riverside church").waitFor();
    await card().getByText("2 Quay Road · America/New York").waitFor();
  });

  await step("a new event picks it: its place and time zone follow", async () => {
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Evening service");
    await dialog.getByTestId("event-location").selectOption({ label: "Riverside church" });
    if ((await dialog.getByLabel("Place (optional)").inputValue()) !== "Riverside church") throw new Error("place not filled");
    if ((await dialog.getByLabel("Time zone").inputValue()) !== "America/New_York") throw new Error("time zone not the location's");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByTestId("team-calendar").locator("[data-event-date]").first().getByText("Riverside church").waitFor();
    const [event] = await api(admin, "GET", `/teams/${team.id}/events`);
    if (!event?.locationId) throw new Error(`no location saved: ${JSON.stringify(event)}`);
  });

  await step("edited, then removed: the event keeps its place", async () => {
    await card().getByRole("button", { name: "Edit" }).click();
    await card().getByTestId("location-form").getByLabel("Name").fill("Riverside");
    await card().getByTestId("location-form").getByRole("button", { name: "Save" }).click();
    await card().getByTestId("location-row").getByText("Riverside", { exact: true }).waitFor();
    await card().getByRole("button", { name: "Remove" }).click();
    await card().getByRole("button", { name: "Remove" }).click();
    await card().getByText("No locations yet.").waitFor();
    const [event] = await api(admin, "GET", `/teams/${team.id}/events`);
    if (event.locationId !== null || event.place !== "Riverside church") throw new Error(JSON.stringify(event));
  });
} finally {
  await browser.close();
}
finish();
