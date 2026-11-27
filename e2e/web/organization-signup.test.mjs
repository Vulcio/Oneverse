// Signing up by asking for an organisation (issue #533), in the browser:
// switched on in Admin > Users, the sign-up tab at Oneverse starts with the
// organisation - its address checked as it's typed - then the account. The
// account only shows where its request stands, the apps send it there, and
// once a global admin approves the request it's open. With the address
// lookup on (France's base, a stand-in here), the street suggests addresses
// that fill the rest; the phone number is checked once it's left.
import { chromium } from "playwright";
import { FAKE_PROVIDERS_URL, startFakeProviders } from "../lib/fake-providers.mjs";
import { ONEVERSE, VERIFY_LINK_PATTERN, WEB, call, check, finish, logOffset, signIn, sql, stamp, stepper, user, waitForLog } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Org signup admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const address = `e2e-web-org-signup-${stamp}@example.com`;
const name = `Bethel Church ${stamp}`;
// Left by an earlier run: they'd look like this one.
sql(`delete from "OrganizationRequest" where lower(street) = '8 quai des chartrons'`);
sql(`delete from "Organization" where lower(street) = '8 quai des chartrons'`);

let browser;
const providers = await startFakeProviders();
try {
  await call(admin, "DELETE", "/admin/organizations/settings");
  await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", addressLookup: true, photonUrl: `${FAKE_PROVIDERS_URL}/photon` });
  await call(admin, "PUT", "/admin/security", { signupInviteOnly: true });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await step("Admin > Users: by invitation only, then anyone asking for their organisation", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/users`);
    const card = page.getByTestId("invitations-card");
    const toggle = card.getByTestId("signup-organization-requests-toggle");
    await toggle.waitFor();
    if (await toggle.isChecked()) throw new Error("already on");
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="signup-organization-requests-toggle"]')?.checked);
    await card.getByText("Saved here").first().waitFor();
  });

  await step("signed out: the sign-up tab starts with the organisation", async () => {
    await page.context().clearCookies();
    await page.goto(`${ONEVERSE}/sign-in`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Sign up" }).click();
    await page.getByTestId("organization-signup-step").waitFor();
    if (await page.locator("#signup-email").count()) throw new Error("the account form is shown first");
  });

  await step("the street suggests addresses: picking one fills the postal code and city", async () => {
    await page.fill("#signup-organization-name", name);
    await page.selectOption("#signup-organization-country", "FR");
    await page.locator("#signup-organization-street").pressSequentially("8 quai des chartrons", { delay: 20 });
    const suggestions = page.getByTestId("address-suggestions");
    await suggestions.getByText("Addresses from Base Adresse Nationale").waitFor();
    await suggestions.getByRole("option", { name: "8 Quai des Chartrons 33000 Bordeaux" }).click();
    await suggestions.waitFor({ state: "detached" });
    const filled = [await page.inputValue("#signup-organization-street"), await page.inputValue("#signup-organization-postal-code"), await page.inputValue("#signup-organization-city")].join("|");
    if (filled !== "8 Quai des Chartrons|33000|Bordeaux") throw new Error(filled);
  });

  await step("the phone number is checked once it's left, and shown as it's kept", async () => {
    await page.fill("#signup-organization-first-name", "Jeanne");
    await page.fill("#signup-organization-last-name", "Martin");
    await page.fill("#signup-organization-phone", "05 56 00");
    await page.locator("#signup-organization-phone").blur();
    await page.getByTestId("phone-problem").waitFor();
    if (await page.getByTestId("organization-signup-next").isEnabled()) throw new Error("Next is enabled with a wrong phone number");
    await page.fill("#signup-organization-phone", "05 56 00 00 00");
    await page.getByTestId("phone-kept").getByText("+33 5 56 00 00 00").waitFor();
  });

  await step("the postal code is checked against the country as it's typed", async () => {
    await page.fill("#signup-organization-postal-code", "3300");
    await page.getByTestId("postal-code-problem").waitFor();
    if (await page.getByTestId("organization-signup-next").isEnabled()) throw new Error("Next is enabled with a wrong postal code");
    await page.fill("#signup-organization-postal-code", "33000");
    await page.getByTestId("postal-code-problem").waitFor({ state: "detached" });
  });

  await step("Next: the account, its name the person responsible's", async () => {
    await page.getByTestId("organization-signup-next").click();
    await page.getByTestId("organization-signup-kept").getByText(name).waitFor({ timeout: 15000 });
    if ((await page.inputValue("#signup-name")) !== "Jeanne Martin") throw new Error(await page.inputValue("#signup-name"));
    await page.fill("#signup-email", address);
    await page.fill("#signup-password", "hunter2pass");
    const offset = logOffset();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Check your email").waitFor();
    const [link] = await waitForLog(offset, VERIFY_LINK_PATTERN);
    await page.goto(link);
  });

  await step("signed in: only where the request stands", async () => {
    await page.goto(`${ONEVERSE}/settings/account`);
    if (!page.url().includes("/settings/account")) {
      await page.goto(`${ONEVERSE}/sign-in`);
      await page.fill("#signin-email", address);
      await page.fill("#signin-password", "hunter2pass");
      await page.getByRole("button", { name: "Sign in" }).first().click();
      await page.goto(`${ONEVERSE}/settings/account`);
    }
    const card = page.getByTestId("awaiting-approval");
    await card.getByText("Your organisation is waiting for approval").waitFor();
    await card.getByText(name).waitFor();
    await card.getByText("8 Quai des Chartrons, 33000 Bordeaux, France").waitFor();
    if (await page.getByText("Your apps").count()) throw new Error("the apps are offered");
  });

  await step("Songverse sends them back to Oneverse", async () => {
    await page.goto(`${WEB}/library`);
    await page.waitForURL(`${ONEVERSE}/settings/account`);
    await page.getByTestId("awaiting-approval").waitFor();
  });

  await step("Admin > Organisations: the phone number, and the address found", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const adminPage = await context.newPage();
    await signIn(adminPage, admin);
    await adminPage.goto(`${WEB}/admin/organizations`);
    const card = adminPage.locator("[data-request]", { hasText: name });
    await card.getByTestId("request-address-found").getByText("8 Quai des Chartrons 33000 Bordeaux · BAN").waitFor();
    if ((await card.getByTestId("request-phone").getAttribute("href")) !== "tel:+33556000000") throw new Error("no tel: link");
    await card.getByTestId("request-phone").getByText("+33 5 56 00 00 00").waitFor();
    await context.close();
  });

  await step("approved: the account is open", async () => {
    const userId = sql(`select id from "User" where email='${address}'`);
    const requestId = sql(`select id from "OrganizationRequest" where "requestedById"='${userId}'`);
    const r = await call(admin, "POST", `/admin/organizations/requests/${requestId}/approve`);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    // Oneverse's home, no longer sent back to Settings.
    await page.goto(`${ONEVERSE}/`);
    await page.waitForURL(`${ONEVERSE}/`);
    await page.getByTestId("home").waitFor();
    if (await page.getByTestId("awaiting-approval").count()) throw new Error("still waiting");
    check("approved: in", true);
  });
} finally {
  await call(admin, "PUT", "/admin/security", { signupInviteOnly: null, signupOrganizationRequests: null });
  await call(admin, "DELETE", "/admin/organizations/settings");
  await browser?.close();
  providers.close();
}
finish();
