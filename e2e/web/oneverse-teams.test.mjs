// Teams in the Oneverse app (issue #550): one's teams grouped by organisation,
// then main teams with their sub-teams, then the teams on their own; a new
// team made there (on its own, in an organisation one runs, or under a main
// team one runs); its page managed there - its look and description, and
// invitations by email, sent once and used once - and the invited person
// joining from the link, signing in first.
import { chromium } from "playwright";
import { ONEVERSE, api, call, check, finish, logOffset, sql, stamp, stepper, user, waitForLog } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Teams admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await user("Teams owner");
const bea = await user("Teams bea");
const carl = await user("Teams carl");
await api(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });

const org = await api(owner, "POST", "/organizations", { name: `Teams church ${stamp}` });
const worship = await api(owner, "POST", `/organizations/${org.id}/groups`, { name: `Worship ${stamp}`, usesSongverse: true });
const main = await api(owner, "POST", "/teams", { name: `Main ${stamp}`, color: "teal" });
const solo = await api(owner, "POST", "/teams", { name: `Solo ${stamp}` });

const browser = await chromium.launch();
try {
  await step("API: a sub-team under a main team one runs, never under another's or in a loop", async () => {
    const sub = await api(owner, "POST", "/teams", { name: `Youth ${stamp}`, parentId: main.id, color: "violet" });
    check("made under the main team", sub.parentId === main.id, JSON.stringify(sub));
    check("with its colour", sub.color === "violet", sub.color);
    check("a slug of its own", typeof sub.slug === "string" && sub.slug.length > 0, sub.slug);
    const other = await call(bea, "POST", "/teams", { name: `Bea's ${stamp}`, parentId: main.id });
    check("not under someone else's team", other.status === 403 || other.status === 400, String(other.status));
    const loop = await call(owner, "PATCH", `/teams/${main.id}/group`, { parentId: sub.id });
    check("not under its own sub-team", loop.status === 400, String(loop.status));
    const inOrg = await call(owner, "POST", "/teams", { name: `Inside ${stamp}`, parentId: worship.id });
    check("not under an organisation's group", inOrg.status === 400, String(inOrg.status));
  });

  await step("API: an invitation by email is sent once, kept until used, and not to a member", async () => {
    const offset = logOffset();
    const first = await api(owner, "POST", `/teams/${main.id}/invitations`, { email: bea.email.toUpperCase() });
    check("for her address", first.email === bea.email, first.email);
    check("used once", first.maxUses === 1, String(first.maxUses));
    await waitForLog(offset, new RegExp(`/join/${first.token}`));
    const again = await api(owner, "POST", `/teams/${main.id}/invitations`, { email: bea.email });
    check("sent again, same link", again.id === first.id, `${first.id} ${again.id}`);
    const member = await call(owner, "POST", `/teams/${main.id}/invitations`, { email: owner.email });
    check("not to a member", member.status === 409, String(member.status));
    const notAdmin = await call(bea, "POST", `/teams/${main.id}/invitations`, { email: "someone@example.com" });
    check("only its admins invite", notAdmin.status === 403, String(notAdmin.status));
    await api(owner, "DELETE", `/teams/${main.id}/invite-links/${first.id}`);
  });

  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" });

  await step("signing in at Oneverse, Teams in the header", async () => {
    await page.goto(ONEVERSE);
    await page.waitForURL(`${ONEVERSE}/sign-in**`);
    await page.waitForLoadState("networkidle");
    await page.fill("#signin-email", owner.email);
    await page.fill("#signin-password", "hunter2pass");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${ONEVERSE}/`);
    const team = page.getByTestId("home-team").filter({ hasText: `Main ${stamp}` });
    await team.waitFor();
    check("the home's team opens here", (await team.getAttribute("href")) === `/teams/${main.id}`, await team.getAttribute("href"));
    await page.getByTestId("teams-link").click();
    await page.waitForURL(`${ONEVERSE}/teams`);
  });

  await step("the teams grouped: the organisation's, main teams with their sub-teams, the others", async () => {
    const inOrg = page.getByTestId(`teams-organization-${org.id}`);
    await inOrg.getByText(`Worship ${stamp}`).waitFor();
    const families = page.getByTestId("teams-families");
    await families.getByText(`Main ${stamp}`).waitFor();
    const youth = families.getByTestId("teams-row").filter({ hasText: `Youth ${stamp}` });
    check("the sub-team under its main team", (await youth.getAttribute("data-depth")) === "1", await youth.getAttribute("data-depth"));
    await page.getByTestId("teams-single").getByText(`Solo ${stamp}`).waitFor();
    check("a single team isn't with the main teams", (await families.getByText(`Solo ${stamp}`).count()) === 0);
  });

  await step("New team: under a main team", async () => {
    await page.waitForLoadState("networkidle");
    await page.getByTestId("teams-new").click();
    await page.getByTestId("new-team-name").fill(`Kids ${stamp}`);
    await page.getByTestId("new-team-inside").selectOption(`team:${main.id}`);
    await page.getByTestId("new-team-create").click();
    await page.waitForURL(new RegExp(`${ONEVERSE}/teams/[^/]+$`));
    const id = page.url().split("/").pop();
    const made = (await api(owner, "GET", "/teams?all=true")).find((one) => one.id === id);
    check("made under the main team", made?.parentId === main.id, JSON.stringify(made));
  });

  await step("New team: in the organisation one runs, as one of its groups", async () => {
    await page.goto(`${ONEVERSE}/teams`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("teams-new").click();
    await page.getByTestId("new-team-name").fill(`Choir ${stamp}`);
    await page.getByTestId("new-team-inside").selectOption(`organization:${org.id}`);
    await page.getByTestId("new-team-create").click();
    await page.waitForURL(new RegExp(`${ONEVERSE}/teams/[^/]+$`));
    const id = page.url().split("/").pop();
    const made = (await api(owner, "GET", "/teams?all=true")).find((one) => one.id === id);
    check("in the organisation", made?.organization?.id === org.id, JSON.stringify(made));
  });

  await step("its page: the description, set here", async () => {
    await page.goto(`${ONEVERSE}/teams/${main.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("appearance-description").fill(`We lead on Sundays ${stamp}`);
    await page.getByTestId("appearance-description-save").click();
    await expectTeam((team) => team.description === `We lead on Sundays ${stamp}`, "the description saved");
    check("Songverse's settings a link away", (await page.getByTestId("team-songverse-link").getAttribute("href"))?.endsWith(`/teams/${main.id}`));
  });

  let token;
  await step("its page: invite by email, waiting until she joins", async () => {
    const offset = logOffset();
    await page.getByTestId("invite-email").fill(bea.email);
    await page.getByTestId("invite-send").click();
    await page.locator(`[data-testid="team-invitation"][data-email="${bea.email}"]`).waitFor();
    token = (await waitForLog(offset, /\/join\/([A-Za-z0-9_-]+)/))[1];
    check("the email's link is Oneverse's", (await waitForLog(offset, new RegExp(`${ONEVERSE}/join/${token}`))) !== null);
  });

  await step("the invited person: signs in from the link and is in the team", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const other = await context.newPage();
    await other.goto(`${ONEVERSE}/join/${token}`);
    await other.waitForURL(`${ONEVERSE}/sign-in**`);
    await other.waitForLoadState("networkidle");
    await other.fill("#signin-email", bea.email);
    await other.fill("#signin-password", "hunter2pass");
    await other.getByRole("button", { name: "Sign in", exact: true }).click();
    await other.waitForURL(`${ONEVERSE}/teams/${main.id}`).catch(async (error) => {
      throw new Error(`${error.message.split("\n")[0]} - at ${other.url()}: ${(await other.locator("body").innerText()).slice(0, 300)}`);
    });
    const team = (await api(bea, "GET", "/teams")).find((one) => one.id === main.id);
    check("a member now", team?.currentUserRole === "MEMBER", JSON.stringify(team));
    const again = await call(bea, "POST", `/teams/join/${token}`);
    check("opened again, she's still in it", again.status < 300, String(again.status));
    const used = await call(carl, "POST", `/teams/join/${token}`);
    check("the invitation works once", used.status === 403, String(used.status));
    await context.close();
  });
} finally {
  await browser.close();
}

async function expectTeam(test, name) {
  for (let i = 0; i < 20; i++) {
    const team = (await api(owner, "GET", "/teams")).find((one) => one.id === main.id);
    if (team && test(team)) return check(name, true);
    await new Promise((r) => setTimeout(r, 250));
  }
  check(name, false);
}

finish();
