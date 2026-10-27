// Admin > Security (issue #113): the rate limits and the API docs' access,
// each saying where it comes from; saved, then reverted to the environment.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Security page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, admin);

await step("the page: each setting, where it comes from", async () => {
  await page.goto(`${WEB}/admin/security`);
  // Often the part's first page: filled and saved once it has hydrated.
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Security" }).waitFor();
  await page.getByLabel("Per signed-in user, a minute").waitFor();
  if (!(await page.getByTestId("security-source").innerText()).includes("defaults")) throw new Error(await page.getByTestId("security-source").innerText());
});

await step("a limit saved here, then back to the environment", async () => {
  await page.getByLabel("Per signed-in user, a minute").fill("700");
  await page.getByTestId("security-save").click();
  await page.getByTestId("security-source").getByText("saved in the database").waitFor();
  const saved = await api(admin, "GET", "/admin/security");
  if (saved.settings.rateLimitPerMinute.value !== 700 || saved.settings.rateLimitAnonymousPerMinute.source === "database") throw new Error(JSON.stringify(saved.settings));
  await page.getByRole("button", { name: "Revert to environment variables" }).click();
  await page.getByRole("button", { name: "Confirm revert" }).click();
  await page.getByTestId("security-source").getByText("defaults").waitFor();
});

await browser.close();
finish();
