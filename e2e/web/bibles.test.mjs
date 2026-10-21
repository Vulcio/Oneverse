// Admin > Bibles (issue #304): YouVersion's App Key saved, then a passage
// read through it, with its version's copyright beneath - against the
// suites' stand-in for YouVersion (lib/fake-providers.mjs).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stepper, user } from "../lib/harness.mjs";
import { startFakeProviders, youversionKey } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
let page;
const step = stepper(() => page);
const admin = await user("Bibles admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/scriptures/youversion");
youversionKey.key = "yvp-e2e-app-key-0123456789";

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, admin);

  await step("Admin > Bibles: no App Key, nothing to try", async () => {
    await page.goto(`${WEB}/admin/bibles`);
    await page.getByTestId("youversion-source").getByText("no App Key").waitFor();
    if (await page.getByTestId("youversion-try").count()) throw new Error("a passage to try without a key");
  });

  await step("the App Key saved: it's the database's", async () => {
    await page.locator("#youversion-app-key").fill(youversionKey.key);
    await page.getByTestId("youversion-settings").getByRole("button", { name: "Save" }).click();
    await page.getByTestId("youversion-source").getByText("the App Key saved here").waitFor();
  });

  await step("a passage read, its copyright beneath", async () => {
    await page.getByRole("button", { name: "Find versions" }).click();
    await page.locator("#youversion-version").waitFor();
    await page.locator("#youversion-reference").fill("John 3:16-17");
    await page.getByRole("button", { name: "Read" }).click();
    const passage = page.getByTestId("youversion-passage");
    await passage.getByText("BSB text of John 3:17.").waitFor();
    await passage.getByText("The Holy Bible, Berean Standard Bible, BSB.").waitFor();
  });
} finally {
  await api(admin, "DELETE", "/admin/scriptures/youversion");
  await browser.close();
  fake.close();
}
finish();
