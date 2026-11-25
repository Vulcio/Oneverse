// The app switcher (issue #552): a grid in every app's header - Oneverse's
// home, Plan, Songverse, Screen's console - listing the apps one can open,
// the current one marked. The same list as the home's tiles: an app shows
// when it's deployed and one's roles allow it. Switching keeps the place
// where the other app has it (a team between Plan and Songverse, a set
// between Songverse and the console), else the app's home. Ctrl K finds
// the other apps by name.
import { chromium } from "playwright";
import { ONEVERSE, PLANIVERSE, SCREEN, WEB, api, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Switch admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const musician = await user("Switch musician");
const planner = await user("Switch planner");
const desk = await user("Switch desk");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });

const team = await api(musician, "POST", "/teams", { name: `Switch band ${stamp}` });
const set = await api(musician, "POST", "/setlists", { name: `Switch set ${stamp}` });
// An organisation's group that only plans: the planner's and the desk's.
const org = await api(admin, "POST", "/organizations", { name: `Switch church ${stamp}` });
const kids = await api(admin, "POST", `/organizations/${org.id}/groups`, { name: `Switch kids ${stamp}` });
for (const [n, who] of [planner, desk].entries()) {
  sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('oms${n}${stamp}', '${org.id}', '${who.id}', 'MEMBER', now(), now()) on conflict do nothing`);
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tms${n}${stamp}', '${kids.id}', '${who.id}', 'MEMBER', now(), now())`);
}
// The desk runs screens by a role.
const role = await api(admin, "POST", "/admin/roles", { name: `Switch screens ${stamp}`, canOperateScreens: true });
await api(admin, "PUT", `/admin/users/${desk.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });

const appsOf = async (who) => (await api(who, "GET", "/users/me/apps")).map((link) => link.app).join(",");
const menuHref = (app) => page.getByTestId(`app-switcher-${app}`).getAttribute("href");

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC" });

  await step("the apps each one can open: deployed, and as their roles allow", async () => {
    check("a Songverse team's member: all four", (await appsOf(musician)) === "oneverse,plan,songverse,screen", await appsOf(musician));
    check("a group that only plans: Oneverse and Plan", (await appsOf(planner)) === "oneverse,plan", await appsOf(planner));
    check("with a role that runs screens: the console too", (await appsOf(desk)) === "oneverse,plan,screen", await appsOf(desk));
    const [first] = await api(musician, "GET", "/users/me/apps");
    check("with their addresses", first.url === ONEVERSE, first.url);
  });

  await step("Songverse: the switcher, by the keyboard, Songverse marked", async () => {
    await signIn(page, musician);
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.waitForLoadState("networkidle");
    const button = page.getByTestId("app-switcher");
    await button.focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("app-switcher-menu").waitFor();
    check("Songverse is the current one", (await page.getByTestId("app-switcher-songverse").getAttribute("aria-current")) === "page");
    check("the team in Plan", (await menuHref("plan")) === `${PLANIVERSE}/teams/${team.id}`, await menuHref("plan"));
    check("the home", (await menuHref("oneverse")) === ONEVERSE, await menuHref("oneverse"));
    check("the console", (await menuHref("screen")) === `${SCREEN}/operate`, await menuHref("screen"));
    await page.keyboard.press("Escape");
  });

  await step("Songverse to Plan keeps the team", async () => {
    await page.getByTestId("app-switcher").click();
    await page.getByTestId("app-switcher-plan").click();
    await page.waitForURL(`${PLANIVERSE}/teams/${team.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("app-switcher").click();
    check("Plan is the current one", (await page.getByTestId("app-switcher-plan").getAttribute("aria-current")) === "page");
    check("back to the team in Songverse", (await menuHref("songverse")) === `${WEB}/teams/${team.id}`, await menuHref("songverse"));
    await page.keyboard.press("Escape");
  });

  await step("a set in Songverse opens in the console, and back", async () => {
    await page.goto(`${WEB}/sets/${set.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("app-switcher").click();
    check("the set's console", (await menuHref("screen")) === `${SCREEN}/operate/${set.id}`, await menuHref("screen"));
    await page.getByTestId("app-switcher-screen").click();
    await page.waitForURL(`${SCREEN}/operate/${set.id}**`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("app-switcher").click();
    check("Screen is the current one", (await page.getByTestId("app-switcher-screen").getAttribute("aria-current")) === "page");
    check("back to the set in Songverse", (await menuHref("songverse")) === `${WEB}/sets/${set.id}`, await menuHref("songverse"));
    await page.keyboard.press("Escape");
  });

  await step("the home's switcher: Oneverse marked, the others at their homes", async () => {
    await page.goto(ONEVERSE);
    await page.getByTestId("home").waitFor();
    await page.getByTestId("app-switcher").click();
    check("Oneverse is the current one", (await page.getByTestId("app-switcher-oneverse").getAttribute("aria-current")) === "page");
    check("Plan's calendar", (await menuHref("plan")) === `${PLANIVERSE}/calendar`, await menuHref("plan"));
    check("Songverse", (await menuHref("songverse")) === WEB, await menuHref("songverse"));
    await page.keyboard.press("Escape");
  });

  await step("Ctrl K in Songverse finds Plan by its name", async () => {
    await page.goto(`${WEB}/library`);
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Songs, sets/).fill("plan");
    const group = page.getByTestId("search-apps");
    await group.getByText("Plan", { exact: true }).click();
    await page.waitForURL(`${PLANIVERSE}/calendar`);
  });
} finally {
  await browser.close();
}
finish();
