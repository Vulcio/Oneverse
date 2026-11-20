// Announcements in the browser (issue #536): a global admin writes one in
// Admin > Announcements, in English and French, sees it as the bell will,
// and sends it to an organisation's members; a member finds it under the
// bell in their language, and pressing it opens its link. An organisation's
// admin writes theirs on its page. Nothing here goes to everyone: other
// suites share the database.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Announce admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const orgAdmin = await user("Announce org admin");
const member = await user("Announce member");
sql(`update "User" set locale='fr' where id='${member.id}'`);
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI" });
const organization = await api(admin, "POST", "/admin/organizations", { name: `Announce Web ${stamp}`, adminEmail: orgAdmin.email });
sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omaw${stamp}', '${organization.id}', '${member.id}', 'MEMBER', now(), now())`);
const choir = await api(orgAdmin, "POST", "/teams", { name: `Announce choir ${stamp}` });
sql(`update "Team" set "organizationId"='${organization.id}' where id='${choir.id}'`);
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmaw${stamp}', '${choir.id}', '${member.id}', 'MEMBER', now(), now())`);
const title = `Version ${stamp}`;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await step("Admin > Announcements: written in English and French, seen as the bell will show it, sent to an organisation", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/announcements`);
    await page.getByTestId("announcement-new").click();
    await page.getByTestId("announcement-title-en").fill(title);
    await page.getByTestId("announcement-body-en").fill("Pinch to zoom charts.");
    await page.getByTestId("announcement-url-en").fill("/sets");
    await page.getByTestId("announcement-title-fr").fill(`La ${title}`);
    await page.getByTestId("announcement-body-fr").fill("Zoomez sur les grilles.");
    // A page of the app by its name (issue #536): what they play or do.
    await page.getByTestId("announcement-page-fr").selectOption("/dashboard#roles");
    if ((await page.getByTestId("announcement-url-fr").inputValue()) !== "/dashboard#roles") throw new Error("the page wasn't put in the link");
    await page.getByTestId("announcement-preview").filter({ hasText: title }).waitFor();
    await page.getByTestId("announcement-audience").selectOption("ORGANIZATION");
    await page.getByTestId("announcement-organization").selectOption(organization.id);
    await page.getByTestId("announcement-save").click();
    const row = page.getByTestId("announcement").filter({ hasText: title });
    await row.getByText("Draft").waitFor();
    await row.getByTestId("announcement-reach").filter({ hasText: "Would go to 2 people now" }).waitFor();
    await row.getByTestId("announcement-send").click();
    await row.getByTestId("announcement-send-confirm").filter({ hasText: "Send to 2 people" }).click();
    await row.getByTestId("announcement-reach").filter({ hasText: "to 2 people" }).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/announcements-admin.png` });
  });

  await step("a member finds it under the bell, in French; pressing it opens its page, at its card", async () => {
    await page.context().clearCookies();
    await signIn(page, member);
    await page.goto(`${WEB}/library`);
    await page.getByTestId("notification-count").waitFor();
    await page.getByTestId("notification-bell").click();
    const item = page.locator('[data-notification="ORGANIZATION_ANNOUNCEMENT"]');
    await item.getByText(`La ${title}`).waitFor();
    await item.getByText(`${organization.name} · Zoomez sur les grilles.`).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/announcements-bell.png` });
    await item.getByRole("button").first().click();
    await page.waitForURL("**/dashboard#roles");
    await page.locator("#roles").waitFor();
    await page.waitForFunction(() => {
      const box = document.getElementById("roles")?.getBoundingClientRect();
      return !!box && box.top >= 0 && box.top < window.innerHeight;
    });
  });

  await step("Account: news pushed, not emailed until chosen", async () => {
    await page.goto(`${WEB}/dashboard#notifications`);
    const email = page.getByRole("checkbox", { name: /Les nouvelles de ce serveur.*E-mail/ });
    await email.waitFor();
    if (await email.isChecked()) throw new Error("emailed by default");
  });

  await step("an organisation's admin writes theirs on its page, for one of its groups", async () => {
    await page.context().clearCookies();
    await signIn(page, orgAdmin);
    await page.goto(`${WEB}/organizations/${organization.id}`);
    const card = page.getByTestId("announcements");
    await card.getByTestId("announcement-new").click();
    await card.getByTestId("announcement-title-en").fill("New meeting place");
    await card.getByTestId("announcement-audience").selectOption("TEAMS");
    await card.locator(`[data-team="${choir.name}"]`).check();
    await card.getByTestId("announcement-save").click();
    const row = card.getByTestId("announcement").filter({ hasText: "New meeting place" });
    await row.getByTestId("announcement-reach").filter({ hasText: choir.name }).waitFor();
    await row.getByTestId("announcement-send").click();
    await row.getByTestId("announcement-send-confirm").click();
    await row.getByTestId("announcement-reach").filter({ hasText: "Sent" }).waitFor();
  });

  await step("a team's admin writes theirs on the team's page", async () => {
    await page.goto(`${WEB}/teams/${choir.id}`);
    const card = page.getByTestId("announcements");
    await card.getByTestId("announcement-new").click();
    await card.getByTestId("announcement-title-en").fill("Rehearsal moved to 7pm");
    if (await card.getByTestId("announcement-audience").count()) throw new Error("a team's admin picks no audience");
    await card.getByTestId("announcement-save").click();
    const row = card.getByTestId("announcement").filter({ hasText: "Rehearsal moved to 7pm" });
    await row.getByTestId("announcement-reach").filter({ hasText: "Would go to 2 people now" }).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/announcements-team.png`, fullPage: true });
  });
} finally {
  await browser.close();
}

finish();
