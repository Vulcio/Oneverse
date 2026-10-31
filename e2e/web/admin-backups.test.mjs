// Admin > Backups (issue #119): nothing set means no backups, said plainly; a
// bucket saved here, "Back up now" run by the Worker and listed with what it
// copied; then back to the environment. The version shows in Background jobs and Admin's sidebar (issue #164).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { startFakeS3 } from "../lib/fake-s3.mjs";

const s3 = await startFakeS3();
let page;
const step = stepper(() => page);
const admin = await user("Backups page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/backups/config");

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, admin);

await step("with nothing set: no backups, and Back up now can't be pressed", async () => {
  await page.goto(`${WEB}/admin/backups`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Backups" }).waitFor();
  await page.getByTestId("backups-source").getByText("Nothing configured").waitFor();
  await page.getByText("Nothing is backed up").waitFor();
  if (!(await page.getByTestId("backup-now").isDisabled())) throw new Error("Back up now is enabled without a destination");
});

await step("a bucket saved here, then Back up now", async () => {
  await page.getByLabel("Endpoint").fill(s3.url);
  await page.getByLabel("Bucket", { exact: true }).fill("page-backups");
  await page.getByLabel("Folder in the bucket").fill(`web-${stamp}`);
  await page.getByLabel("Access key ID").fill("page-key");
  await page.getByLabel("Secret access key").fill("page-secret");
  await page.getByTestId("backups-save").click();
  await page.getByTestId("backups-source").getByText("saved in the database").waitFor();
  await page.getByText("Every night at 03:00 UTC").waitFor();
  // The saved values fill the form again, the secret only as kept.
  if ((await page.getByLabel("Bucket", { exact: true }).inputValue()) !== "page-backups" || !(await page.getByTestId("backup-enabled").isChecked())) throw new Error("the form doesn't show what was saved");
  await page.getByPlaceholder("Leave blank to keep the current one").waitFor();
  const before = await page.getByTestId("backup-run").count();
  await page.getByTestId("backup-now").click();
  await page.waitForFunction((count) => document.querySelectorAll('[data-testid="backup-run"]').length > count, before);
  await page.waitForFunction(() => document.querySelector('[data-testid="backup-run"]')?.getAttribute("data-status") !== "running", null, { timeout: 60000 });
  const first = page.getByTestId("backup-run").first();
  if ((await first.getAttribute("data-status")) !== "ok") throw new Error(await first.innerText());
  await first.getByText(/new file\(s\)/).waitFor();
  await page.getByText("Last successful backup").waitFor();
  if (s3.keys("page-backups", `web-${stamp}/db/`).length !== 1) throw new Error(s3.keys("page-backups").join());
});

await step("back to the environment", async () => {
  await page.getByRole("button", { name: "Revert to environment variables" }).click();
  await page.getByRole("button", { name: "Confirm revert" }).click();
  await page.getByTestId("backups-source").getByText("Nothing configured").waitFor();
});

await step("the version is at the foot of Admin's sidebar, and opens Metadata", async () => {
  await page.goto(`${WEB}/admin/backups`);
  const version = page.getByTestId("admin-version").filter({ visible: true }).first();
  await version.getByText(/Oneverse \d+\.\d+\.\d+/).waitFor();
  await version.click();
  await page.waitForURL(/\/admin\/metadata/);
});

await step("Background jobs says which version runs, and the database's migration", async () => {
  await page.goto(`${WEB}/admin/metadata`);
  await page.getByTestId("server-version").getByText(/Oneverse \d+\.\d+\.\d+/).waitFor();
  await page.getByTestId("server-version").getByText(/Database at migration \d+_/).waitFor();
});

await browser.close();
await s3.close();
finish();
