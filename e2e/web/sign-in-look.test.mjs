// The sign-in page's look (issue #422): light, dark or as the device is, remembered on the
// device and set before the page paints; passwords one can look at; the rule said up front.
import { chromium } from "playwright";
import { ONEVERSE, finish, stepper } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const browser = await chromium.launch();
const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
const checked = async (choice) => (await page.getByTestId(`theme-${choice}`).getAttribute("aria-checked")) === "true";

await step("the sign-in page follows the device until a theme is picked", async () => {
  const context = await browser.newContext({ colorScheme: "dark" });
  page = await context.newPage();
  await page.goto(`${ONEVERSE}/sign-in`);
  await page.waitForLoadState("networkidle");
  if (!(await isDark())) throw new Error("a dark device gets a light page");
  // Dark all over, not only its buttons: light text on a dark page.
  const lightness = (color) => Number(/oklch\(([\d.]+)/.exec(color)?.[1] ?? NaN);
  const { background, text } = await page.evaluate(() => ({ background: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color }));
  if (!(lightness(background) < 0.4 && lightness(text) > 0.8)) throw new Error(`dark page: background ${background}, text ${text}`);
  if (!(await checked("device"))) throw new Error("\"As this device\" isn't the choice to begin with");
  // The device changing is followed while nothing is picked.
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
});

await step("Light is kept on a dark device, across a reload, with no dark flash", async () => {
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  if (!(await checked("light"))) throw new Error("Light isn't shown as picked");
  // Before anything paints: the class is right when the document's own scripts have run, the app's not yet.
  await page.route("**/*.js", (route) => route.abort());
  await page.route("**/*.tsx", (route) => route.abort());
  await page.goto(`${ONEVERSE}/sign-in`, { waitUntil: "domcontentloaded" });
  if (await isDark()) throw new Error("the page is dark before the app loads, though Light was picked");
  await page.unroute("**/*.js");
  await page.unroute("**/*.tsx");
  await page.goto(`${ONEVERSE}/sign-in`);
  await page.waitForLoadState("networkidle");
  if (await isDark()) throw new Error("Light wasn't remembered");
  await page.waitForFunction(() => document.querySelector('[data-testid="theme-light"]')?.getAttribute("aria-checked") === "true");
  // The new password page keeps it too.
  await page.goto(`${ONEVERSE}/reset-password`);
  await page.getByTestId("theme-switch").waitFor();
  if (await isDark()) throw new Error("the reset page is dark");
});

await step("Dark, then back to the device's", async () => {
  await page.goto(`${ONEVERSE}/sign-in`);
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("radio", { name: "As this device" }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  const stored = await page.evaluate(() => localStorage.getItem("oneverse.theme"));
  if (stored !== null) throw new Error(`still stored: ${stored}`);
});

await step("a password can be looked at, and the rule is said before a try", async () => {
  await page.fill("#signin-password", "hunter2pass");
  if ((await page.getAttribute("#signin-password", "type")) !== "password") throw new Error("the password shows to begin with");
  await page.getByRole("button", { name: "Show the password" }).click();
  if ((await page.getAttribute("#signin-password", "type")) !== "text") throw new Error("the eye doesn't show the password");
  if ((await page.inputValue("#signin-password")) !== "hunter2pass") throw new Error("what was typed is gone");
  await page.getByRole("button", { name: "Hide the password" }).click();
  if ((await page.getAttribute("#signin-password", "type")) !== "password") throw new Error("the eye doesn't hide it again");
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.getByText("At least 8 characters.").waitFor();
  if ((await page.getAttribute("#signup-password", "aria-describedby")) !== "signup-password-hint") throw new Error("the rule isn't tied to the field");
});

await step("a wrong password is announced", async () => {
  await page.getByRole("tab", { name: "Sign in" }).click();
  await page.fill("#signin-email", "nobody-at-all@example.com");
  await page.fill("#signin-password", "not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Invalid email or password" }).waitFor();
});

await browser.close();
finish();
