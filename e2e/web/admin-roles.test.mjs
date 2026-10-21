// Admin > Roles and Admin > Teams (issue #160): a storage tier created on
// the Roles page; the Reviewer role and the tier given to a team on the
// Teams page, its pool growing; a member of the team then reviewing (the
// Review link); the teams' default storage limit on Admin > Storage.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Roles page admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const member = await user("Roles page member");
const team = await api(admin, "POST", "/teams", { name: `Roles page band ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tmrp${stamp}', '${team.id}', '${member.id}', 'MEMBER', now())`);
const tierName = `Storage 2 GB ${stamp}`;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, admin);

  await step("Admin > Roles: the built-in roles, and a storage tier created", async () => {
    await page.goto(`${WEB}/admin/roles`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "Roles" }).waitFor();
    await page.getByTestId("role-Reviewer").getByText("Built-in").waitFor();
    await page.getByTestId("role-new").click();
    await page.getByLabel("Name").fill(tierName);
    await page.getByTestId("role-storage").check();
    await page.getByLabel("Storage (MB)").fill("2048");
    await page.getByTestId("role-save").click();
    await page.getByTestId(`role-${tierName}`).getByText(/Stores 2(\.0)? GB/).waitFor();
  });

  await step("Admin > Teams: the Reviewer role and the tier given to a team, its pool grown", async () => {
    await page.goto(`${WEB}/admin/teams`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("Search teams…").fill(team.name);
    const row = page.getByRole("row").filter({ hasText: team.name });
    await row.getByText(/\/ 50(\.0)? MB/).waitFor();
    await row.getByTestId(`team-roles-${team.id}`).click();
    const list = page.getByTestId("roles-dialog-list");
    await list.getByLabel(/^Reviewer/).check();
    await list.getByLabel(new RegExp(tierName)).check();
    await page.getByTestId("roles-dialog-save").click();
    await row.getByTestId("team-roles").getByText(tierName).waitFor();
    await row.getByText(/\/ 2(\.0)? GB/).waitFor();
  });

  await step("Admin > Users: the member's roles, from the team", async () => {
    await page.goto(`${WEB}/admin/users`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("Search by name or email…").fill(member.email);
    const row = page.getByRole("row").filter({ hasText: member.email });
    await row.getByTestId("user-roles").getByText("Reviewer").waitFor();
  });

  await step("Admin > Storage: the teams' default limit", async () => {
    await page.goto(`${WEB}/admin/storage`);
    await page.getByLabel("Default limit for a team's pool (MB)").waitFor();
    await page.context().clearCookies();
  });

  await step("a member of the team can review: the Review link", async () => {
    await signIn(page, member);
    await page.goto(`${WEB}/library`);
    await page.getByRole("link", { name: "Review", exact: true }).first().waitFor();
    await page.goto(`${WEB}/review`);
    await page.waitForURL("**/review");
  });

  await step("the Help link tells the docs what they can use", async () => {
    await page.goto(`${WEB}/library`);
    const href = await page.getByTestId("sidebar-docs").getAttribute("href");
    if (!href?.endsWith("?view=reviewer")) throw new Error(href);
  });
} finally {
  const role = (await api(admin, "GET", "/admin/roles")).find((r) => r.name === tierName);
  if (role) await call(admin, "DELETE", `/admin/roles/${role.id}`);
  await call(admin, "DELETE", `/teams/${team.id}`);
  await browser.close();
}
finish();
