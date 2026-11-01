// Backups for people in the browser (issue #351): the Backups card in the
// dashboard's settings makes an archive and offers it to download, turns the
// weekly one on, and imports one back, saying what came in; a team's admins
// have it on the team's page.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Backups web");
await api(me, "POST", "/song-versions", { title: `Backed up ${stamp}`, language: "en", artists: ["Someone"] });
const team = await api(me, "POST", "/teams", { name: `Backups band ${stamp}` });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);
  let archive;

  await step("Backups in the dashboard's settings: an archive made, to download", async () => {
    await page.goto(`${WEB}/dashboard#settings`);
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId("archives-card");
    await card.getByTestId("archive-make").click();
    const row = card.locator('[data-testid="archive-row"][data-kind="EXPORT"][data-status="DONE"]').first();
    await row.waitFor({ timeout: 30000 });
    await row.getByText("1 song").waitFor();
    const [download] = await Promise.all([page.waitForEvent("download"), row.getByTestId("archive-download").click()]);
    archive = await download.path();
    if (!/\.zip$/.test(download.suggestedFilename())) throw new Error(download.suggestedFilename());
  });

  await step("made every week, turned on", async () => {
    const card = page.getByTestId("archives-card");
    await card.getByTestId("archive-weekly").check();
    let saved = false;
    for (let i = 0; i < 20 && !saved; i++) {
      await page.waitForTimeout(250);
      saved = (await api(me, "GET", "/archives?scope=user")).weekly;
    }
    if (!saved) throw new Error("not saved");
  });

  await step("imported back: nothing new, and it says so", async () => {
    const card = page.getByTestId("archives-card");
    await card.getByTestId("archive-import-input").setInputFiles(archive);
    const row = card.locator('[data-testid="archive-row"][data-kind="IMPORT"][data-status="DONE"]').first();
    await row.waitFor({ timeout: 30000 });
    await row.getByTestId("archive-kept").getByText("1 song").waitFor();
  });

  await step("a team's admins have it on the team's page", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("archives-card").waitFor();
  });
} finally {
  await browser.close();
}
finish();
