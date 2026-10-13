// Planiverse (issue #241): the planning on its own, with the same account
// as Songverse. Signed out, its sign-in page; signed in, My calendar with a
// Songverse team's set opening in Songverse; an organisation, a group that
// only plans and a Songverse team, without Songverse's set tools; joining
// an organisation by its link; signing out.
import { chromium } from "playwright";
import { PLANIVERSE, WEB, api, finish, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Planiverse admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const alice = await user("Planiverse alice");
const bob = await user("Planiverse bob");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const org = await api(alice, "POST", "/organizations", { name: `Planiverse org ${stamp}` });
const music = await api(alice, "POST", "/teams", { name: `Music ${stamp}` });
await api(alice, "PUT", `/teams/${music.id}/organization`, { organizationId: org.id });
const welcome = await api(alice, "POST", `/organizations/${org.id}/groups`, { name: `Welcome ${stamp}` });
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const service = await api(alice, "POST", `/teams/${music.id}/events`, { title: "Sunday service", date: tomorrow, startTime: "10:00", timeZone: "UTC" });
const { setlistId } = await api(alice, "POST", `/teams/${music.id}/events/${service.id}/dates/${tomorrow}/set`);
await api(alice, "POST", `/teams/${welcome.id}/events`, { title: "Door welcome", date: tomorrow, startTime: "09:30", timeZone: "UTC" });
const { token } = await api(alice, "POST", `/organizations/${org.id}/invite-links`, {});

async function signInHere(who) {
  await page.goto(PLANIVERSE);
  await page.fill("#signin-email", who.email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${PLANIVERSE}/calendar`);
}

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });

  await step("signed out: Planiverse's own sign-in page", async () => {
    await page.goto(`${PLANIVERSE}/calendar`);
    await page.waitForURL(`${PLANIVERSE}/`);
    await page.getByText("Planiverse", { exact: true }).first().waitFor();
    if ((await page.title()) !== "Planiverse") throw new Error(`title: ${await page.title()}`);
  });

  await step("signed in with the Songverse account: My calendar, the set opening in Songverse", async () => {
    await signInHere(alice);
    const row = page.locator("[data-event-date]", { hasText: "Sunday service" }).first();
    await row.waitFor();
    const href = await row.getByRole("link", { name: /Open set/ }).getAttribute("href");
    if (href !== `${WEB}/sets/${setlistId}`) throw new Error(`the set opens at ${href}`);
    await page.locator("[data-event-date]", { hasText: "Door welcome" }).first().waitFor();
  });

  await step("the organisation, its groups, a group's page in Planiverse", async () => {
    await page.getByTestId("nav-organizations").click();
    await page.getByText(`Planiverse org ${stamp}`).click();
    await page.waitForURL(`${PLANIVERSE}/organizations/${org.id}`);
    await page.getByRole("link", { name: `Welcome ${stamp}` }).click();
    await page.waitForURL(`${PLANIVERSE}/teams/${welcome.id}`);
    await page.getByTestId("team-calendar").getByText("Door welcome").first().waitFor();
  });

  await step("a Songverse team's calendar: its set opens in Songverse, no set made from here", async () => {
    await page.goto(`${PLANIVERSE}/teams/${music.id}`);
    const calendar = page.getByTestId("team-calendar");
    const open = calendar.getByTestId("calendar-open-set").first();
    if ((await open.getAttribute("href")) !== `${WEB}/sets/${setlistId}`) throw new Error(`the set opens at ${await open.getAttribute("href")}`);
    if (await calendar.getByTestId("calendar-sets-ahead").count()) throw new Error("Planiverse offers to make sets");
    await page.goto(`${PLANIVERSE}/organizations/${org.id}/events`);
    await page.getByTestId("org-new-event").waitFor();
  });

  await step("someone joins the organisation by its link, in Planiverse", async () => {
    await page.context().clearCookies();
    await signInHere(bob);
    await page.goto(`${PLANIVERSE}/join-organization/${token}`);
    await page.waitForURL(`${PLANIVERSE}/organizations/${org.id}`);
    const mine = await api(bob, "GET", "/organizations");
    if (!mine.organizations.some((one) => one.id === org.id)) throw new Error("not in the organisation");
  });

  await step("signs out from the menu", async () => {
    await page.getByTestId("user-menu").click();
    await page.getByTestId("sign-out").click();
    await page.waitForURL(`${PLANIVERSE}/`);
    await page.goto(`${PLANIVERSE}/calendar`);
    await page.waitForURL(`${PLANIVERSE}/`);
  });
} finally {
  await browser.close();
  await api(admin, "DELETE", "/admin/organizations/settings");
}
finish();
