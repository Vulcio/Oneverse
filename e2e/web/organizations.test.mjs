// Organisations in the browser (issue #241): with several allowed, someone
// creates one from the sidebar's Organisations, puts their team in it from
// the team's page, and invites someone by link, who lands on its page; a
// global admin sees it in Admin > Organisations and changes the mode there.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Org web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Org web alice");
const bob = await user("Org web bob");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const team = await api(alice, "POST", "/teams", { name: `Welcome ${stamp}` });
const name = `Grace ${stamp}`;
let inviteUrl;

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await step("someone creates an organisation from the sidebar", async () => {
    await signIn(page, alice);
    await page.goto(`${WEB}/library`);
    await page.getByTestId("sidebar-organizations").first().click();
    await page.waitForURL(/\/organizations$/);
    await page.getByLabel("Name").fill(name);
    await page.getByTestId("organization-create").click();
    await page.waitForURL(/\/organizations\/[^/]+$/);
    await page.getByRole("heading", { name }).waitFor();
  });

  await step("…makes an invite link", async () => {
    await page.getByTestId("invite-link-create").click();
    inviteUrl = await page.getByTestId("invite-link-url").first().textContent();
    if (!inviteUrl?.includes("/join-organization/")) throw new Error(`not an organisation link: ${inviteUrl}`);
  });

  await step("…and puts their team in it, from the team's page", async () => {
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("team-organization-select").selectOption({ label: name });
    await page.getByTestId("team-organization-save").click();
    await page.getByTestId("team-organization").getByText(`Part of ${name}`).waitFor();
  });

  await step("someone opens the link: in it, on its page, its team listed", async () => {
    await page.context().clearCookies();
    await signIn(page, bob);
    await page.goto(inviteUrl.trim());
    await page.waitForURL(/\/organizations\/[^/]+$/);
    await page.getByTestId("organization-teams").getByText(`Welcome ${stamp}`).waitFor();
    await page.getByTestId("organization-members").getByText("Org web bob").waitFor();
  });

  await step("Admin > Organisations: listed, and the mode changed and reverted", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/organizations`);
    await page.getByTestId("admin-organizations").getByText(name).waitFor();
    await page.getByTestId("organization-mode").selectOption("NONE");
    await page.getByTestId("organization-settings-save").click();
    await page.getByTestId("organization-settings-source").getByText("saved in the database").waitFor();
    await page.getByRole("button", { name: "Revert to environment variables" }).click();
    await page.getByRole("button", { name: "Confirm revert" }).click();
    await page.waitForFunction(() => !document.body.textContent.includes("Revert to environment variables"));
    if ((await page.getByTestId("organization-mode").inputValue()) !== "NONE") throw new Error("not back to none");
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/organizations/settings");
}
finish();
