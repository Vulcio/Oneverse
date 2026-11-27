// Web push in the browser (issue #236): Admin > Notifications generates the
// keys; Account > Notifications turns this device on (the browser's
// subscription stood in for, pointing at lib/fake-push.mjs - headless
// Chromium can't reach Google's push service), lists it, sends a test
// that arrives, sets quiet hours, and turns it off. The bell (issue #568)
// offers to turn it on here, links to the settings, and "Not now" stops
// asking on this device; Getting started puts notifications first.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stepper, user } from "../lib/harness.mjs";
import { startFakePush } from "../lib/fake-push.mjs";

let page;
const step = stepper(() => page);
const push = await startFakePush();
const admin = await user("Push web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const member = await user("Push web member");
const dev = push.device("browser");
await api(admin, "DELETE", "/admin/notifications");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["notifications"], { origin: WEB });
  // The browser's push subscription, stood in for: this device's, at the stand-in push service; and
  // its permission (headless Chromium always says "denied", whatever was granted).
  await context.addInitScript(({ endpoint, keys }) => {
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Notification.requestPermission = async () => "granted";
    let current = null;
    const subscription = { endpoint, toJSON: () => ({ endpoint, expirationTime: null, keys }), unsubscribe: async () => ((current = null), true) };
    PushManager.prototype.subscribe = async () => (current = subscription);
    PushManager.prototype.getSubscription = async () => current;
  }, { endpoint: dev.endpoint, keys: dev.keys });
  page = await context.newPage();

  await step("Admin > Notifications: not set up, then keys generated", async () => {
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/notifications`);
    await page.getByTestId("push-status").getByText("Not set up").waitFor();
    await page.getByTestId("vapid-generate").click();
    await page.getByTestId("push-status").getByText("Ready").waitFor();
    if (!(await page.getByTestId("vapid-public").inputValue())) throw new Error("the public key should show");
    if (await page.getByTestId("vapid-private").inputValue()) throw new Error("the private key must never show");
    // …but the field says it's there (issue #237).
    if (!(await page.getByTestId("vapid-private").getAttribute("placeholder"))?.includes("Saved and hidden")) throw new Error("the private key field should say it's saved");
  });

  await step("Account: this device turned on, listed as this device", async () => {
    await page.context().clearCookies();
    await signIn(page, member);
    await page.goto(`${WEB}/settings/notifications`);
    const card = page.getByTestId("notification-settings");
    await card.getByTestId("push-on").click();
    await card.locator("[data-device]").getByText("This device").waitFor();
    await card.getByTestId("push-off").waitFor();
    const devices = await api(member, "GET", "/users/me/push-subscriptions");
    if (devices.length !== 1 || devices[0].endpoint !== dev.endpoint || !devices[0].label?.includes("Chrome")) throw new Error(JSON.stringify(devices));
  });

  await step("Send a test notification: it arrives", async () => {
    await page.getByTestId("push-test").click();
    await page.getByText("Sent: it should show in a moment.").waitFor();
    for (let i = 0; i < 60 && push.for(dev).length === 0; i++) await page.waitForTimeout(250);
    if (push.for(dev)[0]?.message?.body !== "Notifications work on this device.") throw new Error(JSON.stringify(push.pushes));
  });

  await step("Quiet hours: on, from 22:00 to 07:00 in their zone, changed, off", async () => {
    const card = page.getByTestId("notification-settings");
    await card.getByTestId("quiet-on").check();
    await card.getByTestId("quiet-hours").waitFor();
    await card.getByTestId("quiet-from").fill("23:00");
    await card.getByTestId("quiet-from").blur();
    for (let i = 0; i < 40; i++) {
      if ((await api(member, "GET", "/users/me/notifications/settings")).quiet?.from === "23:00") break;
      await page.waitForTimeout(250);
    }
    const quiet = (await api(member, "GET", "/users/me/notifications/settings")).quiet;
    if (quiet?.from !== "23:00" || quiet.to !== "07:00" || !quiet.timeZone) throw new Error(JSON.stringify(quiet));
    await card.getByTestId("quiet-on").uncheck();
    await card.getByTestId("quiet-hours").waitFor({ state: "detached" });
  });

  await step("this device turned off: gone from the list", async () => {
    await page.getByTestId("push-off").click();
    await page.getByTestId("push-on").waitFor();
    await page.getByText("No device gets notifications yet.").waitFor();
  });

  await step("bell: Get them on this device too, turned on there; gone once on", async () => {
    await page.goto(`${WEB}/sets`);
    await page.getByTestId("notification-bell").click();
    const row = page.getByTestId("notification-list").getByTestId("push-here");
    await row.getByText("Get them on this device too").waitFor();
    await row.getByTestId("push-here-on").click();
    await row.waitFor({ state: "detached" });
    const devices = await api(member, "GET", "/users/me/push-subscriptions");
    if (devices.length !== 1 || devices[0].endpoint !== dev.endpoint) throw new Error(JSON.stringify(devices));
  });

  await step("bell: Notification settings opens the card", async () => {
    await page.getByTestId("notification-settings-link").click();
    await page.waitForURL(/\/settings\/notifications$/);
    await page.getByTestId("notification-settings").getByTestId("push-off").waitFor();
  });

  await step("bell: Not now stops asking on this device, after a reload too", async () => {
    await page.getByTestId("push-off").click();
    await page.getByTestId("push-on").waitFor();
    await page.getByTestId("notification-bell").click();
    const row = page.getByTestId("push-here");
    await row.getByTestId("push-here-later").click();
    await row.waitFor({ state: "detached" });
    await page.reload();
    await page.getByTestId("notification-bell").click();
    await page.getByTestId("notification-list").getByTestId("notification-see-all").waitFor();
    // Given the row the time it would take to show.
    await page.waitForTimeout(1000);
    if (await page.getByTestId("push-here").count()) throw new Error("Not now should hide it on this device");
    await page.keyboard.press("Escape");
  });

  await step("Getting started: notifications first, turned on in place", async () => {
    await page.goto(`${WEB}/library`);
    const card = page.getByTestId("getting-started");
    await card.locator('[data-step="notifications"]').waitFor();
    const steps = await card.locator("[data-step]").evaluateAll((items) => items.map((item) => item.getAttribute("data-step")));
    if (steps.join() !== "notifications,song,team,set") throw new Error(steps.join());
    await card.getByTestId("getting-started-push").click();
    await card.locator('[data-step="notifications"][data-done="true"]').waitFor();
    const devices = await api(member, "GET", "/users/me/push-subscriptions");
    if (devices.length !== 1) throw new Error(JSON.stringify(devices));
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/notifications");
  await push.close();
}
finish();
