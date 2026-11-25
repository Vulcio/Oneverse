// Oneverse's home (issue #538): where one lands after signing in at Oneverse.
// The apps one can open (the switcher's list, issue #552), one's next dates answered right there, the places
// another group opened to one's own (issue #528) taken from there, the news
// (announcements, issue #536), one's teams opening in the app they're
// planned in, the organisation brand's links (members only), and the
// settings. With two organisations, one chosen at the top.
import { chromium } from "playwright";
import { ONEVERSE, PLANIVERSE, SCREEN, WEB, api, call, check, finish, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Home admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const planner = await user("Home planner");
const anne = await user("Home anne");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const org = await api(planner, "POST", "/organizations", { name: `Home church ${stamp}` });
const music = await api(planner, "POST", `/organizations/${org.id}/groups`, { name: `Music ${stamp}`, usesSongverse: true });
const kids = await api(planner, "POST", `/organizations/${org.id}/groups`, { name: `Kids ${stamp}` });
const join = (who, teamId, n) => {
  sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('omh${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmh${n}${stamp}', '${teamId}', '${who.id}', 'MEMBER', now(), now())`);
};
join(anne, kids.id, 1);
// Anne's group's date, to answer; the music team's, with a place open to her group.
await api(planner, "POST", `/teams/${kids.id}/events`, { title: `Kids club ${stamp}`, date: plus(2), startTime: "10:00", timeZone: "UTC" });
await api(planner, "POST", `/teams/${music.id}/events`, { title: `Sunday ${stamp}`, date: plus(3), startTime: "10:00", timeZone: "UTC", parts: [{ part: "MEDIA_OPERATOR", count: 1, openTo: [kids.id] }] });
// The organisation's news, and its brand's links.
const news = await api(planner, "POST", `/organizations/${org.id}/announcements`, { texts: { en: { title: `Rehearsals start ${stamp}`, body: "After the service." } } });
await api(planner, "POST", `/organizations/${org.id}/announcements/${news.id}/send`);
const brand = await api(planner, "POST", "/brands", { name: `Home brand ${stamp}`, organizationId: org.id });
await api(planner, "PATCH", `/brands/${brand.id}`, { website: "https://example.org", socials: [{ network: "instagram", url: "https://instagram.com/example" }], whatsapp: [{ name: "Church group", url: "https://chat.whatsapp.com/example", purpose: "" }] });
// Anne's other organisation, with nothing in it.
const other = await api(anne, "POST", "/organizations", { name: `Other place ${stamp}` });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });

  await step("signing in at Oneverse lands on the home", async () => {
    await page.goto(ONEVERSE);
    await page.waitForURL(`${ONEVERSE}/sign-in**`);
    await page.waitForLoadState("networkidle");
    await page.fill("#signin-email", anne.email);
    await page.fill("#signin-password", "hunter2pass");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${ONEVERSE}/`);
    await page.getByRole("heading", { name: "Hello, Home anne" }).waitFor();
  });

  await step("the apps: Plan only for someone whose groups only plan (issue #552)", async () => {
    const plan = await page.getByTestId("home-app-plan").getAttribute("href");
    check("Plan opens its calendar", plan === `${PLANIVERSE}/calendar`, plan);
    check("no Songverse tile", (await page.getByTestId("home-app-songverse").count()) === 0);
    check("no Screen tile", (await page.getByTestId("home-app-screen").count()) === 0);
  });

  await step("the organisation chosen at the top: its teams, news and links", async () => {
    await page.getByTestId("home-organization").selectOption(org.id);
    const team = page.getByTestId("home-team").filter({ hasText: `Kids ${stamp}` });
    await team.waitFor();
    check("a group that only plans opens in Plan", (await team.getAttribute("href")) === `${PLANIVERSE}/teams/${kids.id}`, await team.getAttribute("href"));
    await page.getByTestId("home-news").getByText(`Rehearsals start ${stamp}`).waitFor();
    const follow = page.getByTestId("home-follow");
    await follow.getByRole("link", { name: "Instagram" }).waitFor();
    await follow.getByRole("link", { name: "Website" }).waitFor();
    check("its WhatsApp group", (await page.getByTestId("home-whatsapp").getAttribute("href")) === "https://chat.whatsapp.com/example");
  });

  await step("a date answered from the home", async () => {
    const row = page.locator("[data-event-date]", { hasText: `Kids club ${stamp}` });
    await row.getByTestId("answer-AVAILABLE").click();
    await row.locator("[data-testid=answer-AVAILABLE][aria-pressed=true]").waitFor();
    const answer = sql(`select answer from "TeamEventAnswer" where "userId"='${anne.id}'`);
    check("the answer is kept", answer === "AVAILABLE", answer);
  });

  await step("a place another group opened, taken from the home", async () => {
    const places = page.getByTestId("open-places");
    await places.getByTestId("open-place-take").click();
    await places.waitFor({ state: "detached" });
    await page.locator("[data-event-date]", { hasText: `Sunday ${stamp}` }).locator("[data-my-place]").waitFor();
  });

  await step("the other organisation: no teams of its own, and no links", async () => {
    await page.getByTestId("home-organization").selectOption(other.id);
    await page.getByTestId("home-team").filter({ hasText: `Kids ${stamp}` }).waitFor({ state: "detached" });
    check("no links without a brand", (await page.getByTestId("home-follow").count()) === 0);
  });

  await step("the account's settings from the header", async () => {
    await page.getByTestId("account-link").click();
    await page.waitForURL(`${ONEVERSE}/account`);
    await page.getByTestId("home-link").click();
    await page.waitForURL(`${ONEVERSE}/`);
    await page.getByTestId("home").waitFor();
  });

  // A Songverse team's member, on a server with the screen app: its console.
  await step("a Songverse musician sees the screens' console", async () => {
    sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmh9${stamp}', '${music.id}', '${anne.id}', 'MEMBER', now(), now())`);
    await page.reload();
    const href = await page.getByTestId("home-app-screen").getAttribute("href");
    check("Screen opens its console", href === `${SCREEN}/operate`, href);
    const songverse = await page.getByTestId("home-app-songverse").getAttribute("href");
    check("and Songverse", songverse === WEB, songverse);
  });

  // Members only: someone outside sees none of the organisation's brands.
  const stranger = await user("Home stranger");
  const brands = await call(stranger, "GET", `/brands?organizationId=${org.id}`);
  check("an outsider gets no brand links", brands.status === 403 || brands.status === 404 || (Array.isArray(brands.body) && brands.body.length === 0), `${brands.status} ${JSON.stringify(brands.body).slice(0, 200)}`);
} finally {
  await browser.close();
}
finish();
