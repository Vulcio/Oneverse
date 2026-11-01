// An organisation's groups in the browser (issue #241): its admin makes a
// group that only plans from the organisation's page, gives it positions
// and ticks the one they cover, has an event ask for one, puts it under the
// music team; the organisation's page shows it under it, and Songverse's
// sidebar doesn't list it among the teams. Its admin renames it (issue #244) and makes a sub-group
// under it (issue #245).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Groups web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Groups web alice");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const org = await api(alice, "POST", "/organizations", { name: `Groups web ${stamp}` });
const music = await api(alice, "POST", "/teams", { name: `Music ${stamp}` });
await api(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
const welcome = `Welcome ${stamp}`;
let groupUrl;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await step("the organisation's admin makes a group that only plans", async () => {
    await signIn(page, alice);
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.getByTestId("organization-new-group").click();
    const form = page.getByTestId("organization-group-form");
    await form.getByLabel("Name").fill(welcome);
    await form.getByTestId("group-create").click();
    await page.waitForURL(/\/teams\/[^/]+$/);
    await page.getByRole("heading", { name: welcome }).waitFor();
    groupUrl = page.url();
  });

  await step("…gives it positions, and ticks the one they cover", async () => {
    const card = page.getByTestId("team-positions");
    for (const name of ["Greeter", "Coffee"]) {
      await card.getByLabel("New position").fill(name);
      await card.getByTestId("position-add").click();
      await card.locator(`[data-position="${name}"]`).waitFor();
    }
    const mine = page.locator(`[data-member-positions="${alice.id}"]`);
    await mine.getByRole("button", { name: "Greeter" }).click();
    await mine.locator('button[aria-pressed="true"]', { hasText: "Greeter" }).waitFor();
  });

  await step("…an event of the group asks for two greeters", async () => {
    await page.getByTestId("calendar-new-event").click();
    const dialog = page.getByTestId("event-dialog");
    await dialog.getByLabel("Title").fill("Sunday welcome");
    await dialog.getByTestId("event-part-add").selectOption({ label: "Greeter" });
    const part = dialog.locator('[data-part^="position:"]');
    await part.getByRole("spinbutton").fill("2");
    await dialog.getByRole("button", { name: "Save event" }).click();
    await dialog.waitFor({ state: "hidden" });
    // Alice ticked Greeter but hasn't answered yet: two short.
    await page.getByTestId("calendar-short").first().getByText("Greeter ×2").waitFor();
    // Kept as the group's position, not a name.
    const [event] = await api(alice, "GET", `/teams/${new URL(page.url()).pathname.split("/").pop()}/events`);
    if (!event?.parts[0]?.position) throw new Error(`saved as ${JSON.stringify(event?.parts)}`);
  });

  await step("…and puts it under the music team", async () => {
    const card = page.getByTestId("team-group-card");
    await card.getByTestId("team-parent").selectOption({ label: `Music ${stamp}` });
    await card.getByTestId("team-group-save").click();
    await page.goto(`${WEB}/organizations/${org.id}`);
    const row = page.locator('[data-depth="1"]', { hasText: welcome });
    await row.getByText("Only plans").waitFor();
  });

  await step("Songverse's sidebar lists the music team, not the group", async () => {
    await page.goto(`${WEB}/teams`);
    await page.getByRole("link", { name: `Music ${stamp}` }).first().waitFor();
    if (await page.getByRole("link", { name: welcome }).count()) throw new Error("the group that only plans is among Songverse's teams");
  });

  await step("its admin renames it: the new name everywhere", async () => {
    await page.goto(groupUrl);
    await page.getByTestId("team-rename").click();
    await page.getByTestId("team-name-input").fill(`Welcome team ${stamp}`);
    await page.getByTestId("team-name-save").click();
    await page.getByRole("heading", { name: `Welcome team ${stamp}` }).waitFor();
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.locator('[data-depth="1"]', { hasText: `Welcome team ${stamp}` }).waitFor();
  });

  await step("…and makes a sub-group under it, from its page", async () => {
    await page.goto(groupUrl);
    await page.getByTestId("organization-new-group").filter({ hasText: "New sub-group" }).click();
    const form = page.getByTestId("organization-group-form");
    await form.getByText(`Under Welcome team ${stamp}`).waitFor();
    await form.getByLabel("Name").fill(`Parking ${stamp}`);
    await form.getByTestId("group-create").click();
    await page.getByRole("heading", { name: `Parking ${stamp}` }).waitFor();
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.locator('[data-depth="2"]', { hasText: `Parking ${stamp}` }).waitFor();
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/organizations/settings");
}
finish();
