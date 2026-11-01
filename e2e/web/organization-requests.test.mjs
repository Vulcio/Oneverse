// Asking for an organisation in the browser (issue #364): someone fills in
// Ask for an organisation; one that looks like a request already waiting is
// shown and sent only with a note; a global admin approves it in Admin >
// Organisations, and its new admin finds its setup checklist on its page,
// ticked as they go, and puts it away.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Orgreq web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Orgreq web alice");
const bob = await user("Orgreq web bob");
await api(admin, "DELETE", "/admin/organizations/settings");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
sql(`delete from "OrganizationRequest" where name like 'Harbour Chapel %'`);
const name = `Harbour Chapel ${stamp}`;
// Bob asked first, for one of the same name in the same city.
await api(bob, "POST", "/organizations/requests", { name, kind: "CHURCH", city: "Brest", contactName: "Bob", contactEmail: "bob@example.org" });
let organizationUrl;

async function fill(page, city) {
  const form = page.getByTestId("organization-request-form");
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("What it is").selectOption("CHURCH");
  await form.getByLabel("City").fill(city);
  await form.getByLabel("Contact person").fill("Alice Le Gall");
  await form.getByLabel("Contact email").fill("alice@example.org");
}

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await step("someone asks for an organisation: one like it waits already", async () => {
    await signIn(page, alice);
    await page.goto(`${WEB}/organizations`);
    await page.waitForLoadState("networkidle");
    await fill(page, "Brest");
    await page.getByTestId("organization-request-send").click();
    await page.getByTestId("request-looks-like").getByText(`${name} · Brest`).waitFor();
    // Sent only with a word on why it isn't the same.
    if (await page.getByTestId("organization-request-send").isEnabled()) throw new Error("sent without a note");
  });

  await step("…says why it isn't the same, and it's waiting", async () => {
    await page.getByLabel("Why it isn't the same").fill("We're the chapel by the harbour, not the one in town");
    await page.getByTestId("organization-request-send").click();
    await page.getByTestId("my-organization-requests").getByText(name).waitFor();
    await page.getByTestId("my-organization-requests").getByText("Waiting for review").waitFor();
  });

  await step("a global admin sees it, what it looks like and the note, and approves it", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/organizations`);
    const request = page.locator("[data-request]").filter({ hasText: "Alice Le Gall" });
    await request.getByText("We're the chapel by the harbour").waitFor();
    await request.getByTestId("request-looks-like").getByText(name).waitFor();
    await request.getByTestId("request-approve").click();
    await page.getByTestId("admin-organizations").getByText(name).waitFor();
  });

  await step("…declines the other with a reason", async () => {
    const request = page.locator("[data-request]").filter({ hasText: "Orgreq web bob" });
    await request.getByTestId("request-decline").click();
    await request.getByTestId("request-decline-reason").fill("Already here: ask its admins");
    await request.getByTestId("request-decline-confirm").click();
    await page.getByText(`${name} · Brest: declined by Orgreq web admin`).waitFor({ state: "attached" });
  });

  await step("its new admin opens it from the notification: the setup checklist", async () => {
    await page.context().clearCookies();
    await signIn(page, alice);
    const told = (await api(alice, "GET", "/users/me/notifications?limit=20")).items.find((item) => item.kind === "ORGANIZATION_APPROVED");
    if (!told?.url) throw new Error("not told");
    organizationUrl = `${WEB}${told.url}`;
    await page.goto(organizationUrl);
    const setup = page.getByTestId("organization-setup");
    await setup.getByText("Set up your organisation (0 of").waitFor();
    await setup.locator('[data-step="invite"][data-done="false"]').waitFor();
  });

  await step("…ticked as they go, then put away and brought back", async () => {
    await page.waitForLoadState("networkidle");
    await page.getByTestId("invite-link-create").click();
    await page.getByTestId("organization-setup").locator('[data-step="invite"][data-done="true"]').waitFor();
    await page.getByTestId("organization-setup-dismiss").click();
    await page.getByTestId("organization-setup").waitFor({ state: "detached" });
    await page.getByTestId("organization-setup-show").click();
    await page.getByTestId("organization-setup").waitFor();
  });
} finally {
  await browser.close();
  const made = sql(`select id from "Organization" where name='${name}'`);
  if (made) await api(admin, "DELETE", `/admin/organizations/${made}`);
  sql(`delete from "OrganizationRequest" where name like 'Harbour Chapel %'`);
  await api(admin, "DELETE", "/admin/organizations/settings");
}
finish();
