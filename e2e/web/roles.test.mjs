// Browser test for the merged dashboard + roles (issue #17).
import { chromium } from "playwright";
import { WEB, SP, stamp, tag, sql, stepper, user, api, signIn, finish } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
async function headerBadges(expected) {
  let got;
  for (let i = 0; i < 40; i++) {
    got = (await page.getByRole("list", { name: "Roles" }).first().locator("li").allInnerTexts().catch(() => [])).join("|");
    if (got === expected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`header badges: ${got}`);
}

const leader = await user("Leader Roles");
const member = await user("Member Roles");
const team = await api(leader, "POST", "/teams", { name: `Roles ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmr${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await signIn(page, member);

await step("dashboard shows overview and settings together", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Welcome back, Member Roles" }).waitFor();
  for (const name of ["Recently updated", "Teams", "Profile", "Roles", "Your Oneverse account", "Storage", "Language"]) {
    if ((await page.getByText(name, { exact: true }).count()) === 0) throw new Error(`missing ${name}`);
  }
  await page.getByRole("link", { name: "Add what you play or do" }).waitFor();
});
await page.screenshot({ path: `${SP}/roles-dashboard-empty.png`, fullPage: true });

await step("/account redirects to the dashboard's settings", async () => {
  await page.goto(`${WEB}/account`);
  await page.waitForURL(/\/dashboard#settings$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Settings" }).waitFor();
});

await step("sidebar menu's Account settings goes to the settings section", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  await page.locator("[data-slot=sidebar-footer] button").first().click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  await page.waitForURL(/\/dashboard#settings$/);
  await page.waitForLoadState("networkidle");
});

await step("pick instruments and a role, save, badges appear in the header", async () => {
  const save = page.getByRole("button", { name: "Save roles" });
  if (!(await save.isDisabled())) throw new Error("save enabled before any change");
  await page.getByRole("button", { name: "Drums", exact: true }).click();
  await page.getByRole("button", { name: "Lead vocals", exact: true }).click();
  await page.getByRole("button", { name: "Sound engineer", exact: true }).click();
  if ((await page.getByRole("button", { name: "Drums", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("not pressed");
  await save.click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await headerBadges("Lead vocals|Drums|Sound engineer");
  if (sql(`select array_to_string(instruments, ',') || ';' || array_to_string("techRoles", ',') from "User" where id='${member.id}'`) !== "LEAD_VOCALS,DRUMS;SOUND_ENGINEER") throw new Error("db mismatch");
});

await step("roles survive a reload; unticking and saving removes one", async () => {
  await page.reload();
  await page.waitForLoadState("networkidle");
  if ((await page.getByRole("button", { name: "Lead vocals", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("lost after reload");
  await page.getByRole("button", { name: "Drums", exact: true }).click();
  await page.getByRole("button", { name: "Save roles" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await headerBadges("Lead vocals|Sound engineer");
});
await page.screenshot({ path: `${SP}/roles-dashboard.png`, fullPage: true });

await step("profile name change still works from the dashboard", async () => {
  await page.fill("#display-name", "Member Renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back, Member Renamed" }).waitFor();
});

await step("team page shows members' roles", async () => {
  await page.goto(`${WEB}/teams/${team.id}`);
  await page.waitForLoadState("networkidle");
  // The team's list, not the sidebar's account button (which shows the email too).
  const row = page.getByRole("main").locator("li", { hasText: member.email }).first();
  await row.getByText("Lead vocals").waitFor();
  await row.getByText("Sound engineer").waitFor();
});
await page.screenshot({ path: `${SP}/roles-team.png`, fullPage: true });

await step("French labels", async () => {
  await api(member, "PATCH", "/users/me", { locale: "fr" });
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.getByRole("button", { name: "Chant principal", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ingénieur du son", exact: true }).waitFor();
  await api(member, "PATCH", "/users/me", { locale: "en" });
});

await step("phone width: no horizontal scroll", async () => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(`overflows by ${overflow}px`);
  await page.screenshot({ path: `${SP}/roles-mobile.png`, fullPage: true });
});

await step("no console errors", async () => {
  const relevant = errors.filter((e) => !/favicon/.test(e));
  if (relevant.length) throw new Error(relevant.join(" | "));
});

await browser.close();
finish();
