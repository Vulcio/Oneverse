// Notifications in the browser (issue #236): the bell in the top bar shows
// how many are unread; its list puts each into words in the reader's
// language; pressing one opens what it's about and marks it read; Mark all
// as read clears the count. A request to connect is answered right in the
// list, and See all opens the Notifications page (issue #149).
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Bell admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const member = await user("Bell member");
const team = await api(admin, "POST", `/teams`, { name: `Bell ${stamp}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmb${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const first = plus(2);
const event = await api(admin, "POST", `/teams/${team.id}/events`, { title: "Morning service", date: first, startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 } });
const base = `/teams/${team.id}/events/${event.id}/dates`;
await api(member, "PUT", `${base}/${first}/answer`, { answer: "AVAILABLE" });
await api(admin, "PATCH", `${base}/${first}`, { startTime: "09:30" });
await api(admin, "PUT", `${base}/${plus(9)}/answers/${member.id}`, { answer: "IF_NEEDED" });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "UTC" });

  await step("the bell shows two unread; its list says what happened", async () => {
    await signIn(page, member);
    await page.goto(`${WEB}/sets`);
    await page.getByTestId("notification-count").filter({ hasText: "2" }).waitFor();
    await page.getByTestId("notification-bell").click();
    const list = page.getByTestId("notification-list");
    await list.getByText("Morning service on").first().waitFor();
    await list.getByText("now at 09:30").waitFor();
    await list.getByText("Bell admin answered for you: If needed").waitFor();
    if ((await list.locator('[data-read="false"]').count()) !== 2) throw new Error("both should be unread");
  });

  await step("pressing one opens My calendar and marks it read", async () => {
    await page.locator('[data-notification="EVENT_DATE_CHANGED"]').click();
    await page.waitForURL(/\/calendar$/);
    await page.getByTestId("notification-count").filter({ hasText: "1" }).waitFor();
  });

  await step("Mark all as read clears the count", async () => {
    await page.getByTestId("notification-bell").click();
    await page.getByTestId("notification-read-all").click();
    await page.getByTestId("notification-count").waitFor({ state: "detached" });
    if ((await page.locator('[data-read="false"]').count()) !== 0) throw new Error("all should be read");
  });

  await step("a request to connect, accepted from the bell; See all opens the Notifications page", async () => {
    const stranger = await user("Bell stranger");
    await api(stranger, "POST", "/people/requests", { email: member.email });
    await page.reload();
    await page.getByTestId("notification-count").filter({ hasText: "1" }).waitFor();
    await page.getByTestId("notification-bell").click();
    const request = page.getByTestId("notification-list").locator('[data-notification="CONNECTION_REQUESTED"]');
    await request.getByText("Bell stranger asks to connect with you").waitFor();
    await request.getByTestId("connection-accept").click();
    await request.getByText("Accepted: you're connected").waitFor();
    await page.getByTestId("notification-count").waitFor({ state: "detached" });
    if (!(await api(member, "GET", "/people")).people.some((person) => person.id === stranger.id)) throw new Error("not connected");
    await page.getByTestId("notification-see-all").click();
    await page.waitForURL(/\/notifications$/);
    const all = page.getByTestId("notifications-page");
    await all.getByRole("heading", { name: "Notifications" }).waitFor();
    await all.locator('[data-notification="EVENT_DATE_CHANGED"]').waitFor();
    // Answered already: the page says so rather than answering again.
    await all.locator('[data-notification="CONNECTION_REQUESTED"]').getByTestId("connection-decline").click();
    await all.getByText("Already answered").waitFor();
  });

  await step("Account: each kind by email, off on this server until an admin turns it on", async () => {
    await page.goto(`${WEB}/dashboard`);
    const card = page.getByTestId("notification-settings");
    // Its choices loaded.
    const ready = () => page.locator('[data-testid="notification-settings"][data-ready="true"]').waitFor();
    await ready();
    await card.getByTestId("notification-email-off").waitFor();
    if (!(await card.getByTestId("notify-email-EVENT_DATE_CHANGED").isDisabled())) throw new Error("the choices should wait for the server");
    await api(admin, "PUT", "/admin/notifications", { emailEnabled: true });
    await page.reload();
    await ready();
    await Promise.all([page.waitForResponse((res) => res.url().includes("/notifications/settings") && res.request().method() === "PUT"), card.getByTestId("notify-email-EVENT_DATE_CHANGED").uncheck()]);
    await page.reload();
    await ready();
    if (await card.getByTestId("notify-email-EVENT_DATE_CHANGED").isChecked()) throw new Error("the choice wasn't kept");
    if (!(await card.getByTestId("notify-email-EVENT_DATE_CANCELLED").isChecked())) throw new Error("the other kinds should stay on");
  });

  await step("Admin > Notifications: the switch, where it comes from, back to the environment", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/notifications`);
    if (!(await page.getByTestId("notifications-email-enabled").isChecked())) throw new Error("saved on, should show on");
    await page.getByRole("button", { name: "Revert to environment variables" }).click();
    await page.getByRole("button", { name: "Confirm revert" }).click();
    await page.getByTestId("notifications-email-enabled").and(page.locator(":not(:checked)")).waitFor();
    await page.getByTestId("notifications-email-enabled").check();
    await page.getByTestId("notifications-save").click();
    await page.getByTestId("notification-settings-source").getByText("saved in the database", { exact: false }).waitFor();
    await api(admin, "DELETE", "/admin/notifications");
    await page.context().clearCookies();
    await signIn(page, member);
  });

  await step("in French, in French words", async () => {
    sql(`update "User" set locale = 'fr' where id = '${member.id}'`);
    await page.goto(`${WEB}/sets`);
    await page.getByTestId("notification-bell").click();
    await page.getByTestId("notification-list").getByText("Bell admin a répondu pour vous : Si besoin").waitFor();
  });
} finally {
  await browser.close();
}
finish();
