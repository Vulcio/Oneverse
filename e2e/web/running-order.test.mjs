// A set's running order in the Oneverse app (issue #521), for those who plan
// a service rather than play it: its songs, texts and passages in order,
// added, moved and removed by those who edit it, read only for the others,
// kept the same as Songverse's set page while both are open, and where
// Plan's address for a set leads.
import { chromium } from "playwright";
import { ONEVERSE, PLANIVERSE, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Running order admin");
const member = await user("Running order member");
const team = await api(admin, "POST", "/teams", { name: `Running order band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmro${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const opener = await api(admin, "POST", "/song-versions", { title: `Opening song ${stamp}`, language: "en", artists: ["Someone"], key: "G", teamId: team.id });
const closer = await api(admin, "POST", "/song-versions", { title: `Closing song ${stamp}`, language: "en", artists: ["Someone else"], teamId: team.id });
const set = await api(admin, "POST", "/setlists", { name: `Sunday ${stamp}`, teamId: team.id });
await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: opener.id });
const address = `${ONEVERSE}/sets/${set.id}`;

const titles = async (on) => on.getByTestId("running-order-item-title").allInnerTexts();
const order = () => sql(`select string_agg(coalesce(s.title, i.text->>'title', i.kind::text), '|' order by i.position) from "SetlistItem" i left join "SongVersion" s on s.id = i."songVersionId" where i."setlistId"='${set.id}'`);

const browser = await chromium.launch();
try {
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });
  page = await adminContext.newPage();

  await step("the running order shows the set's items, with Songverse one click away", async () => {
    await signIn(page, admin);
    await page.goto(address);
    await page.getByTestId("running-order-title").filter({ hasText: `Sunday ${stamp}` }).waitFor();
    check("its song", (await titles(page)).join("|") === `Opening song ${stamp}`, (await titles(page)).join("|"));
    check("its editor edits it", (await page.getByTestId("running-order").getAttribute("data-can-edit")) === "true");
    check("Open in Songverse", (await page.getByTestId("running-order-songverse").getAttribute("href")) === `${WEB}/sets/${set.id}`);
  });

  await step("a song is added from the search", async () => {
    await page.getByTestId("running-order-add-song").click();
    const dialog = page.getByTestId("running-order-song-dialog");
    await dialog.getByTestId("running-order-song-search").fill(`Closing song ${stamp}`);
    await dialog.getByTestId("running-order-song-result").filter({ hasText: `Closing song ${stamp}` }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByTestId("running-order-item-title").filter({ hasText: `Closing song ${stamp}` }).waitFor();
  });

  await step("an announcement is added, then moved first", async () => {
    await page.getByTestId("running-order-add-text").click();
    const dialog = page.getByTestId("set-text-dialog");
    await dialog.locator("#set-text-title").fill(`Welcome ${stamp}`);
    await dialog.locator("#set-text-body").fill("Good morning!\n\nCoffee after the service.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "hidden" });
    const welcome = page.getByTestId("running-order-item").filter({ hasText: `Welcome ${stamp}` });
    await welcome.waitFor();
    check("a text item", (await welcome.getAttribute("data-kind")) === "TEXT");
    await welcome.getByTestId("running-order-up").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=running-order-item]")[1]?.textContent?.includes("Welcome"));
    await welcome.getByTestId("running-order-up").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=running-order-item]")[0]?.textContent?.includes("Welcome"));
    check("saved in that order", order() === `Welcome ${stamp}|Opening song ${stamp}|Closing song ${stamp}`, order());
  });

  await step("the passage dialog offers the server's versions, or says there are none", async () => {
    await page.getByTestId("running-order-add-passage").click();
    const dialog = page.getByTestId("running-order-passage-dialog");
    await dialog.waitFor();
    await dialog.locator("[data-testid=running-order-version], [data-testid=running-order-no-bibles]").first().waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });

  await step("Songverse and the Oneverse app show the same set, live", async () => {
    const songverse = await adminContext.newPage();
    await songverse.goto(`${WEB}/sets/${set.id}`);
    await songverse.waitForLoadState("networkidle");
    const inSongverse = songverse.getByTestId("set-song-list").getByRole("link", { name: `Closing song ${stamp}` });
    await inSongverse.waitFor();
    // Removed here: gone from Songverse's set page without a reload.
    await page.getByTestId("running-order-item").filter({ hasText: `Closing song ${stamp}` }).getByTestId("running-order-remove").click();
    await page.getByTestId("running-order-item").filter({ hasText: `Closing song ${stamp}` }).waitFor({ state: "detached" });
    await inSongverse.waitFor({ state: "detached", timeout: 10000 });
    // Changed elsewhere: here without a reload.
    await api(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: closer.id });
    await page.getByTestId("running-order-item-title").filter({ hasText: `Closing song ${stamp}` }).waitFor({ timeout: 10000 });
    await inSongverse.waitFor({ timeout: 10000 });
    await songverse.close();
  });

  await step("Plan's address for a set opens its running order", async () => {
    await page.goto(`${PLANIVERSE}/sets/${set.id}`);
    await page.waitForURL(address);
    await page.getByTestId("running-order-title").waitFor();
  });

  await step("a set one can't open says so", async () => {
    await page.goto(`${ONEVERSE}/sets/nothing-${stamp}`);
    await page.getByTestId("running-order-missing").waitFor();
  });

  await step("a team member who doesn't edit it reads it only", async () => {
    const memberContext = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });
    page = await memberContext.newPage();
    await signIn(page, member);
    await page.goto(address);
    await page.getByTestId("running-order-title").waitFor();
    check("read only", (await page.getByTestId("running-order").getAttribute("data-can-edit")) === "false");
    check("no tools", (await page.getByTestId("running-order-add-song").count()) === 0 && (await page.getByTestId("running-order-remove").count()) === 0);
    check("the same items", (await titles(page)).length === 3, (await titles(page)).join("|"));
  });
} finally {
  await browser.close();
}
finish();
