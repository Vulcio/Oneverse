// One Settings page in every app (issue #540): Account and Notifications
// for every app, then each app's own; on a phone, a list at the top. Light or
// dark is kept on the account, so another app follows it; the password is
// changed at Oneverse.
import { chromium } from "playwright";
import { ONEVERSE, PLANIVERSE, SP, WEB, api, finish, signIn, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Settings Person");

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, me);

  await step("the sidebar's Settings opens Account: profile, language and appearance, sign-in, summaries", async () => {
    await page.locator("[data-slot=sidebar-footer] button").first().click();
    await page.getByTestId("nav-settings").click();
    await page.waitForURL(`${WEB}/settings/account`);
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    const account = page.getByTestId("settings-account");
    await account.getByTestId("profile-card").waitFor();
    if ((await page.getByLabel("First name").inputValue()) !== "Settings") throw new Error("the name wasn't split");
    if ((await page.getByLabel("Last name").inputValue()) !== "Person") throw new Error("the name wasn't split");
    await account.getByTestId("language-card").waitFor();
    await account.getByTestId("oneverse-account").getByRole("link", { name: "Change at Oneverse" }).waitFor();
    await account.getByTestId("notifications-summary").waitFor();
    await account.getByTestId("availability-summary").waitFor();
    // Every app's, then this app's own.
    for (const key of ["account", "notifications", "songverse", "plan"]) await page.getByTestId(`settings-tab-${key}`).waitFor();
    if ((await page.getByTestId("settings-tab-account").getAttribute("aria-current")) !== "page") throw new Error("Account not marked");
    await page.screenshot({ path: `${SP}/settings-account.png`, fullPage: true });
  });

  await step("first and last name: others see them joined", async () => {
    await page.getByLabel("Last name").fill("Personne");
    await page.getByTestId("joined-name").getByText("Settings Personne").waitFor();
    await page.getByTestId("save-name").click();
    await page.getByText("Saved.").waitFor();
    const profile = await api(me, "GET", "/users/me");
    if (profile.displayName !== "Settings Personne" || profile.lastName !== "Personne") throw new Error(JSON.stringify(profile));
  });

  await step("Dark is kept on the account, and Oneverse follows it", async () => {
    await page.getByTestId("account-theme-dark").click();
    await page.locator("html.dark").waitFor({ state: "attached" });
    for (let i = 0; i < 20 && (await api(me, "GET", "/users/me")).theme !== "dark"; i++) await page.waitForTimeout(200);
    if ((await api(me, "GET", "/users/me")).theme !== "dark") throw new Error("not saved on the account");
    // Another app, this device's own choice cleared: the account's wins.
    await page.goto(`${ONEVERSE}/settings/account`);
    await page.evaluate(() => localStorage.removeItem("oneverse.theme"));
    await page.reload();
    await page.locator("html.dark").waitFor({ state: "attached" });
    if ((await page.getByTestId("account-theme-dark").getAttribute("aria-checked")) !== "true") throw new Error("Oneverse doesn't show Dark");
  });

  await step("at Oneverse, Account has the sign-in itself: email, password, passkeys", async () => {
    await page.getByTestId("password-card").waitFor();
    await page.getByLabel("Current password").fill("hunter2pass");
    await page.getByLabel("New password").fill("hunter3pass");
    await page.getByTestId("change-password").click();
    await page.getByText("Password changed.", { exact: false }).waitFor();
    await page.getByLabel("New email").waitFor();
    // Songverse's settings open in Songverse.
    if ((await page.getByTestId("settings-tab-songverse").getAttribute("href")) !== `${WEB}/settings/songverse`) throw new Error("Songverse's tab should open Songverse");
    await page.getByTestId("account-theme-device").click();
    for (let i = 0; i < 20 && (await api(me, "GET", "/users/me")).theme !== "auto"; i++) await page.waitForTimeout(200);
    if ((await api(me, "GET", "/users/me")).theme !== "auto") throw new Error("Auto not saved");
  });

  await step("Notifications: sections, and the summary's Open leads there", async () => {
    await page.goto(`${WEB}/settings/account`);
    await page.getByTestId("notifications-summary").getByRole("link").click();
    await page.waitForURL(`${WEB}/settings/notifications`);
    await page.locator('[data-testid="notification-settings"][data-ready="true"]').waitFor();
    for (const key of ["dates", "lineups", "songs", "people", "news"]) await page.getByTestId(`notify-section-${key}`).waitFor();
    await page.getByTestId("notify-open-songs").click();
    await page.getByTestId("notify-push-SONG_SHARED").waitFor();
    await page.screenshot({ path: `${SP}/settings-notifications.png`, fullPage: true });
  });

  await step("Songverse's and Oneverse Plan's own", async () => {
    await page.getByTestId("settings-tab-songverse").click();
    await page.waitForURL(`${WEB}/settings/songverse`);
    await page.getByTestId("songverse-settings").getByTestId("archives-card").waitFor();
    await page.getByTestId("settings-tab-plan").click();
    await page.waitForURL(`${WEB}/settings/plan`);
    await page.getByTestId("plan-settings").getByTestId("week-start").waitFor();
  });

  await step("a phone: the sections in a list at the top", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB}/settings/account`);
    const picker = page.getByTestId("settings-picker");
    await picker.waitFor();
    if (await page.getByTestId("settings-tab-account").isVisible()) throw new Error("the side menu shows on a phone");
    await picker.selectOption("notifications");
    await page.waitForURL(`${WEB}/settings/notifications`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error(`overflows by ${overflow}px`);
    await page.screenshot({ path: `${SP}/settings-phone.png`, fullPage: true });
  });

  await step("Oneverse Plan: the same page, with its own section", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PLANIVERSE}/account`);
    await page.waitForURL(`${PLANIVERSE}/settings/account`);
    await page.getByTestId("settings-account").waitFor();
    await page.goto(`${PLANIVERSE}/settings/plan`);
    await page.getByTestId("plan-settings").waitFor();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
}
finish();
