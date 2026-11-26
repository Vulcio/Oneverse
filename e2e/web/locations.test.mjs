// Venues (locations, issue #320) in the app: a team's admin adds one on the team's page, with its address and
// time zone, and a room in it (issue #563); a new event picks it, which fills its place and time zone, and one of
// its rooms, and its date shows the room and the place; a resource (issue #564) kept there, taken by another
// event. The hall booked again at the same time is refused, naming who has it, and a series books its free dates
// (issue #565). Edited, then removed: the event keeps its place.
import { chromium } from "playwright";
import { PLANIVERSE, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

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
    await page.goto(`${PLANIVERSE}/teams/${team.id}`);
    await page.waitForLoadState("networkidle");
    await card().getByText("No venues yet.").waitFor();
    await card().getByTestId("location-add").click();
    const form = card().getByTestId("location-form");
    await form.getByLabel("Name").fill("Riverside church");
    await form.getByLabel("Address (optional)").fill("2 Quay Road");
    await form.getByLabel("Time zone").selectOption("America/New_York");
    await form.getByRole("button", { name: "Save" }).click();
    await card().getByTestId("location-row").getByText("Riverside church").waitFor();
    await card().getByText("2 Quay Road · America/New York").waitFor();
  });

  await step("a room in it, with its capacity (issue #563) and setup time (issue #565)", async () => {
    await card().getByTestId("room-add").click();
    await card().getByTestId("room-name").fill("Main hall");
    await card().getByTestId("room-capacity").fill("200");
    await card().getByTestId("room-setup").fill("30");
    await card().getByTestId("room-save").click();
    await card().locator('[data-testid="location-room"][data-room="Main hall"]').getByText("200 people").waitFor();
    await card().locator('[data-testid="location-room"][data-room="Main hall"]').getByText("setup 30 min").waitFor();
  });

  await step("a new event picks it: its place and time zone follow", async () => {
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Evening service");
    await dialog.getByTestId("event-location").selectOption({ label: "Riverside church" });
    if ((await dialog.getByLabel("Place (optional)").inputValue()) !== "Riverside church") throw new Error("place not filled");
    if ((await dialog.getByLabel("Time zone").inputValue()) !== "America/New_York") throw new Error("time zone not the location's");
    await dialog.locator('[data-testid="event-room"][data-room="Main hall"]').getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByTestId("team-calendar").locator("[data-event-date]").first().getByText("Main hall, Riverside church").waitFor();
    const [event] = await api(admin, "GET", `/teams/${team.id}/events`);
    if (!event?.locationId) throw new Error(`no location saved: ${JSON.stringify(event)}`);
    if (event.rooms?.[0]?.name !== "Main hall") throw new Error(`no room saved: ${JSON.stringify(event)}`);
  });

  await step("a resource (issue #564), taken by an event", async () => {
    const resources = page.getByTestId("resources-card");
    await resources.getByTestId("resource-add").click();
    const form = resources.getByTestId("resource-form");
    await form.getByLabel("Name").fill("Projector");
    await form.getByLabel("How many").fill("2");
    await form.getByLabel("Kept at").selectOption({ label: "Riverside church" });
    await form.getByRole("button", { name: "Save" }).click();
    await resources.locator('[data-testid="resource-row"][data-resource="Projector"]').getByText("Kept at Riverside church").waitFor();
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Film night");
    const projector = dialog.locator('[data-testid="event-resource"][data-resource="Projector"]');
    await projector.getByRole("checkbox").check();
    await projector.getByTestId("event-resource-quantity").fill("2");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "detached" });
    const film = (await api(admin, "GET", `/teams/${team.id}/events`)).find((one) => one.title === "Film night");
    if (film?.resources?.[0]?.name !== "Projector" || film.resources[0].quantity !== 2) throw new Error(`no resource saved: ${JSON.stringify(film)}`);
  });

  await step("the hall already booked then (issue #565): who has it, and a series books its free dates", async () => {
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Youth night");
    await dialog.getByTestId("event-location").selectOption({ label: "Riverside church" });
    await dialog.locator('[data-testid="event-room"][data-room="Main hall"]').getByRole("checkbox").check();
    await dialog.locator("#event-repeat").selectOption("1");
    await dialog.getByRole("button", { name: "Save event" }).click();
    const clashes = dialog.getByTestId("booking-clashes");
    await clashes.getByText("Already booked").waitFor();
    await clashes.getByTestId("booking-clash").filter({ hasText: `Main hall on` }).filter({ hasText: `Evening service (Locations ${stamp})` }).waitFor();
    await clashes.getByTestId("booking-book-free").click();
    await dialog.waitFor({ state: "detached" });
    const youth = (await api(admin, "GET", `/teams/${team.id}/events`)).find((one) => one.title === "Youth night");
    if (!youth?.repeat) throw new Error(`series not saved: ${JSON.stringify(youth)}`);
  });

  await step("edited, then removed: the event keeps its place", async () => {
    await card().getByRole("button", { name: "Edit" }).click();
    await card().getByTestId("location-form").getByLabel("Name").fill("Riverside");
    await card().getByTestId("location-form").getByRole("button", { name: "Save" }).click();
    await card().getByTestId("location-row").getByText("Riverside", { exact: true }).waitFor();
    await card().getByRole("button", { name: "Remove", exact: true }).click();
    await card().getByRole("button", { name: "Remove", exact: true }).click();
    await card().getByText("No venues yet.").waitFor();
    const event = (await api(admin, "GET", `/teams/${team.id}/events`)).find((one) => one.title === "Evening service");
    if (event.locationId !== null || event.place !== "Riverside church" || event.rooms?.length) throw new Error(JSON.stringify(event));
  });
} finally {
  await browser.close();
}
finish();
