// Admin > Instruments (issue #166): an admin adds an instrument; anyone picks
// it in Settings > Songverse, and it's named on their dashboard.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Instruments page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const name = `Theremin ${stamp}`;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, admin);

  await step("Admin > Instruments: the built-in list, and one added", async () => {
    await page.goto(`${WEB}/admin/instruments`);
    await page.getByText("Celtic harp").waitFor();
    const form = page.getByTestId("instrument-form-new");
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("In French").fill(`Thérémine ${stamp}`);
    await form.getByRole("button", { name: "Add instrument" }).click();
    await page.getByTestId(`custom-instrument-${name}`).waitFor();
  });

  await step("picked in Settings > Songverse, and named on the dashboard", async () => {
    await page.goto(`${WEB}/settings/songverse`);
    await page.locator("#roles").getByRole("button", { name }).click();
    await page.locator("#roles").getByRole("button", { name: "Save roles" }).click();
    await page.locator("#roles").getByText("Saved.").waitFor();
    await page.goto(`${WEB}/dashboard`);
    await page.getByRole("list", { name: "Roles" }).getByText(name).first().waitFor();
  });

  await step("removed: gone from their roles", async () => {
    await page.goto(`${WEB}/admin/instruments`);
    const row = page.getByTestId(`custom-instrument-${name}`);
    await row.getByRole("button", { name: "Remove" }).click();
    await row.getByRole("button", { name: "Remove it from everyone" }).click();
    await row.waitFor({ state: "detached" });
    if ((await api(admin, "GET", "/users/me")).instruments.length !== 0) throw new Error("still picked");
  });
} finally {
  await browser.close();
}
finish();
