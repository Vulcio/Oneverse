// Browser test for Sets (issue #1).
import { chromium } from "playwright";
import { api, finish, pickDay, sidebarEntry, signIn, SP, sql, stamp, stepper, tag, user, WEB } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// Fixtures
const leader = await user("Leader");
const member = await user("Member");
const team = await api(leader, "POST", "/teams", { name: `Worship ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const grace = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `Amazing Grace ${tag}`, language: "en" });
await api(leader, "PATCH", `/song-versions/${grace.id}`, { key: "G" });
const howGreat = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `How Great ${tag}`, language: "en", teamId: team.id });
await api(leader, "PATCH", `/song-versions/${howGreat.id}`, { key: "C" });
const holy = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `Holy Holy ${tag}`, language: "en" });
sql(`update "SongVersion" set "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED' where id='${holy.id}'`);
const holyTeam = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `Holy Holy ${tag} (acoustic)`, language: "en", teamId: team.id, workId: holy.workId });

const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const longDate = new Date(`${date}T00:00:00Z`).toLocaleDateString("en", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const rows = () => page.getByTestId("set-song-row");
const rowTitles = async () => (await rows().allInnerTexts()).map((text) => text.split("\n").find((line) => line.includes(tag)));
let setUrl;

await step("sidebar has a Sets section", async () => {
  await signIn(page, leader);
  await page.getByRole("link", { name: "Sets", exact: true }).waitFor();
});

await step("create a dated set without a name; it's titled by its date", async () => {
  await page.getByRole("link", { name: "Sets", exact: true }).click();
  await page.waitForURL("**/sets");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-slot="sidebar"]').getByText("No sets yet").waitFor();
  await page.getByRole("link", { name: "New set" }).click();
  await page.waitForURL("**/sets/new");
  await page.waitForLoadState("networkidle");
  // The date on the calendar (issue #235).
  await page.getByTestId("set-date").click();
  await pickDay(page.locator("[data-slot=calendar]").last(), date);
  await page.getByRole("button", { name: "Create set" }).click();
  await page.waitForURL("**/sets/**");
  await page.getByRole("heading", { name: longDate }).waitFor();
  await page.waitForLoadState("networkidle");
  setUrl = page.url();
  await (await sidebarEntry(page, "Sets", longDate)).waitFor(); // sidebar
});

await step("add songs by searching", async () => {
  const search = page.getByPlaceholder("Search by title, artist, number or CCLI…");
  for (const title of [`Amazing Grace ${tag}`, `How Great ${tag}`, `Holy Holy ${tag}`]) {
    await search.fill(title);
    const result = page.getByTestId("set-song-results").getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
    await result.getByRole("button", { name: "Add" }).click();
    await rows().filter({ hasText: title }).first().waitFor();
  }
  if ((await rows().count()) !== 3) throw new Error(`expected 3 rows, got ${await rows().count()}`);
});

await step("set a custom key (shows the resulting key)", async () => {
  const graceRow = rows().filter({ hasText: `Amazing Grace ${tag}` });
  await graceRow.getByLabel("Key").selectOption({ label: "A (+2)" });
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.waitForLoadState("networkidle");
  const selected = await rows().filter({ hasText: `Amazing Grace ${tag}` }).getByLabel("Key").evaluate((el) => el.selectedOptions[0].textContent);
  if (selected !== "A (+2)") throw new Error(`key after reload: ${selected}`);
});

await step("reorder with the keyboard", async () => {
  const handle = page.getByRole("button", { name: `Drag to reorder Holy Holy ${tag}` });
  await handle.focus();
  // dnd-kit measures between key presses, so give it a moment each time.
  for (const key of ["Space", "ArrowUp", "ArrowUp", "Space"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const titles = await rowTitles();
  if (!titles[0]?.startsWith(`Holy Holy ${tag}`)) throw new Error(`order after reload: ${titles.join(" | ")}`);
});

await step("reorder by dragging with the mouse", async () => {
  // Holy Holy is first after the keyboard step; drag Amazing Grace (now second) to the bottom.
  const from = await page.getByRole("button", { name: `Drag to reorder Amazing Grace ${tag}` }).boundingBox();
  const to = await rows().nth(2).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2, from.y + (to.y + to.height - from.y) * (i / 10));
  await page.mouse.up();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const titles = await rowTitles();
  if (!titles[2]?.startsWith(`Amazing Grace ${tag}`)) throw new Error(`order after reload: ${titles.join(" | ")}`);
});

await step("switch a song to another version", async () => {
  const holyRow = rows().filter({ hasText: `Holy Holy ${tag}` });
  await holyRow.getByLabel("Translation").selectOption(holyTeam.id);
  await page.getByTestId("set-song-list").getByRole("link", { name: `Holy Holy ${tag} (acoustic)`, exact: true }).waitFor();
  await page.screenshot({ path: `${SP}/sets-page.png`, fullPage: true });
});

await step("rename the set; the sidebar follows", async () => {
  await page.getByLabel("Name (optional)").fill("Sunday Morning");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Sunday Morning" }).waitFor();
  await (await sidebarEntry(page, "Sets", "Sunday Morning")).waitFor();
  await page.getByText(longDate).first().waitFor(); // date moves to the subtitle
});

await step("remove a song", async () => {
  await page.getByRole("button", { name: `Remove How Great ${tag}` }).click();
  await rows().filter({ hasText: `How Great ${tag}` }).waitFor({ state: "detached" });
  if ((await rows().count()) !== 2) throw new Error("expected 2 rows");
});

let teamSetUrl;
await step("create a team set with a team-only song", async () => {
  await page.goto(`${WEB}/sets/new`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Name (optional)").fill(`Team Night ${tag}`);
  await page.getByLabel("Owner").selectOption({ label: `Worship ${tag}` });
  await page.getByRole("button", { name: "Create set" }).click();
  await page.waitForURL((url) => /^\/sets\/(?!new$)[^/]+$/.test(url.pathname));
  await page.waitForLoadState("networkidle");
  teamSetUrl = page.url();
  await page.getByText("Team sets can only include").waitFor();
  await page.getByPlaceholder("Search by title, artist, number or CCLI…").fill(`Amazing Grace ${tag}`);
  await page.getByText("No matching songs.").waitFor(); // personal song not offered
  await page.getByPlaceholder("Search by title, artist, number or CCLI…").fill(`How Great ${tag}`);
  await page.getByTestId("set-song-results").getByRole("button", { name: "Add" }).first().click();
  await rows().filter({ hasText: `How Great ${tag}` }).waitFor();
});

await step("a team member sees the team set read-only (in French)", async () => {
  sql(`update "User" set locale='fr' where id='${member.id}'`);
  const memberPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const previous = page;
  page = memberPage;
  try {
  await signIn(memberPage, member);
  await memberPage.getByRole("link", { name: "Listes de chants", exact: true }).waitFor();
  await memberPage.goto(teamSetUrl);
  await memberPage.waitForLoadState("networkidle");
  await memberPage.getByText("seuls les administrateurs de l'équipe").waitFor();
  if ((await memberPage.getByRole("button", { name: /Faire glisser/ }).count()) !== 0) throw new Error("drag handles shown to a read-only member");
  if ((await memberPage.getByLabel("Tonalité").count()) !== 0) throw new Error("key picker shown to a read-only member");
  await memberPage.locator("main").getByText(`How Great ${tag}`).waitFor();
  await memberPage.locator("main").getByText("C (originale)").waitFor();
  await memberPage.screenshot({ path: `${SP}/sets-readonly-fr.png`, fullPage: true });
  await memberPage.goto(setUrl);
  await memberPage.getByText("Liste introuvable").waitFor(); // leader's personal set
  } finally {
    page = previous;
  }
});

await step("delete a set", async () => {
  await page.goto(setUrl);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete set" }).click();
  await page.waitForURL(`${WEB}/sets`);
  if ((await page.getByRole("link", { name: "Sunday Morning" }).count()) !== 0) throw new Error("still in sidebar");
  await page.screenshot({ path: `${SP}/sets-index.png`, fullPage: true });
});

await browser.close();
finish();
