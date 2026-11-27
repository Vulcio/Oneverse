// Browser test for the dashboard and what one plays or does (issues #17, #540).
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

await step("the dashboard is the overview; what you play or do is in Settings > Songverse (issue #540)", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Welcome back, Member Roles" }).waitFor();
  for (const name of ["Recently updated", "Teams"]) {
    if ((await page.getByText(name, { exact: true }).count()) === 0) throw new Error(`missing ${name}`);
  }
  if ((await page.getByText("Storage", { exact: true }).count()) > 0) throw new Error("the settings should have left the dashboard");
  await page.getByRole("link", { name: "Add what you play or do" }).click();
  await page.waitForURL(/\/settings\/songverse#roles$/);
  await page.waitForLoadState("networkidle");
  await page.getByText("Storage", { exact: true }).waitFor();
});
await page.screenshot({ path: `${SP}/roles-settings-empty.png`, fullPage: true });

await step("old links land in Settings", async () => {
  await page.goto(`${WEB}/account`);
  await page.waitForURL(/\/settings\/account$/);
  await page.goto(`${WEB}/dashboard#roles`);
  await page.waitForURL(/\/settings\/songverse#roles$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Save roles" }).waitFor();
});

await step("pick instruments and a role, save, badges appear in the header", async () => {
  const save = page.getByRole("button", { name: "Save roles" });
  if (!(await save.isDisabled())) throw new Error("save enabled before any change");
  await page.getByRole("button", { name: "Drums", exact: true }).click();
  await page.getByRole("button", { name: "Lead vocals", exact: true }).click();
  await page.getByRole("button", { name: "Audio operator", exact: true }).click();
  if ((await page.getByRole("button", { name: "Drums", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("not pressed");
  await save.click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await page.goto(`${WEB}/dashboard`);
  await headerBadges("Lead vocals|Drums|Audio operator");
  if (sql(`select array_to_string(instruments, ',') || ';' || array_to_string("techRoles", ',') from "User" where id='${member.id}'`) !== "LEAD_VOCALS,DRUMS;SOUND_ENGINEER") throw new Error("db mismatch");
});

await step("roles survive a reload; unticking and saving removes one", async () => {
  await page.goto(`${WEB}/settings/songverse`);
  await page.waitForLoadState("networkidle");
  if ((await page.getByRole("button", { name: "Lead vocals", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("lost after reload");
  await page.getByRole("button", { name: "Drums", exact: true }).click();
  await page.getByRole("button", { name: "Save roles" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  await page.screenshot({ path: `${SP}/roles-settings.png`, fullPage: true });
  await page.goto(`${WEB}/dashboard`);
  await headerBadges("Lead vocals|Audio operator");
});

await step("team page shows members' roles", async () => {
  await page.goto(`${WEB}/teams/${team.id}`);
  await page.waitForLoadState("networkidle");
  // The team's list, not the sidebar's account button (which shows the email too).
  const row = page.getByRole("main").locator("li", { hasText: member.email }).first();
  await row.getByText("Lead vocals").waitFor();
  await row.getByText("Audio operator").waitFor();
});
await page.screenshot({ path: `${SP}/roles-team.png`, fullPage: true });

await step("French labels", async () => {
  await api(member, "PATCH", "/users/me", { locale: "fr" });
  await page.goto(`${WEB}/settings/songverse`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.getByRole("button", { name: "Chant principal", exact: true }).waitFor();
  await page.getByRole("button", { name: "Sono", exact: true }).waitFor();
  await api(member, "PATCH", "/users/me", { locale: "en" });
});

await step("phone width: no horizontal scroll", async () => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${WEB}/settings/songverse`);
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
