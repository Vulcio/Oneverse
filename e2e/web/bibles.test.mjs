// Admin > Bibles: a Bible file imported (issue #301), what it may be used
// for ticked, a passage read from it, and the Bible deleted; YouVersion's
// App Key saved (issue #304), then a passage read through it, with its
// version's copyright beneath - against the suites' stand-in for YouVersion
// (lib/fake-providers.mjs).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
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

  await step("a Bible file imported: the Worker reads it, its rights all off", async () => {
    await page.waitForLoadState("networkidle");
    await page.getByTestId("bible-file").setInputFiles({
      name: "web.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(
        `<XMLBIBLE biblename="Web Bible ${stamp}"><INFORMATION><identifier>WEB${stamp % 1000}</identifier><rights>Public Domain</rights></INFORMATION>` +
          `<BIBLEBOOK bnumber="19"><CHAPTER cnumber="23"><VERS vnumber="1">The LORD is my shepherd; I shall not want.</VERS><VERS vnumber="2">He maketh me to lie down.</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>`,
      ),
    });
    const row = page.getByTestId("imported-bible").filter({ hasText: `Web Bible ${stamp}` });
    await row.and(page.locator('[data-status="ready"]')).waitFor({ timeout: 30000 });
    await row.getByText("1 books, 2 verses (zefania)").waitFor();
    if (await row.getByTestId("bible-right-projection").isChecked()) throw new Error("projected before the admin said so");
    // Saved, then ticked.
    await row.getByTestId("bible-right-projection").click();
    await row.getByTestId("bible-right-projection").and(page.locator(":checked")).waitFor();
  });

  await step("a passage read from it, its copyright beneath", async () => {
    const tryIt = page.getByTestId("imported-try");
    await tryIt.locator("#imported-version").selectOption({ label: `WEB${stamp % 1000} - Web Bible ${stamp}` });
    await tryIt.locator("#imported-reference").fill("Psalm 23:1-2");
    await tryIt.getByRole("button", { name: "Read" }).click();
    const passage = page.getByTestId("imported-passage");
    await passage.getByText("Psalms 23:1-2").waitFor();
    await passage.getByText("He maketh me to lie down.").waitFor();
    await passage.getByText("Public Domain").waitFor();
  });

  await step("the Bible deleted", async () => {
    const row = page.getByTestId("imported-bible").filter({ hasText: `Web Bible ${stamp}` });
    await row.getByRole("button", { name: "Delete" }).click();
    await row.getByRole("button", { name: "Delete this Bible" }).click();
    await row.waitFor({ state: "detached" });
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
    await page.getByTestId("youversion-try").getByRole("button", { name: "Read" }).click();
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
