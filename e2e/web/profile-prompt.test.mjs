// "What do you play or do?" (issue #109): asked after signing up while
// someone hasn't said, skipped for a while, asked again on joining a team;
// the dashboard's "Complete your profile" card until they have; a team's
// admins see who hasn't said yet.
import { chromium } from "playwright";
import { WEB, stamp, tag, sql, check, stepper, user, api, call, signIn, askProfileAgain, finish } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const lead = await user("Lead Prompt");
const newcomer = await user("Newcomer Prompt");
askProfileAgain(newcomer);

let me = await api(newcomer, "GET", "/users/me");
check("someone who just signed up is asked", me.askProfile === true, JSON.stringify(me.askProfile));
check("…someone who's skipped it isn't", (await api(lead, "GET", "/users/me")).askProfile === false);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await context.newPage();
await signIn(page, newcomer);

await step("the question comes up after signing in", async () => {
  await page.getByTestId("profile-prompt").getByText("What do you play or do?").waitFor();
  if (!(await page.getByTestId("profile-prompt-save").isDisabled())) throw new Error("Save before anything's ticked");
});
await step("Skip for now closes it", async () => {
  await page.getByTestId("profile-prompt-skip").click();
  await page.getByTestId("profile-prompt").waitFor({ state: "hidden" });
});
me = await api(newcomer, "GET", "/users/me");
check("…and it isn't asked again soon", me.askProfile === false && sql(`select "profilePromptSkippedAt" is not null from "User" where id = '${newcomer.id}'`) === "t");
await step("…not on the next page load either", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  if (await page.getByTestId("profile-prompt").isVisible()) throw new Error("asked again");
});
await step("the dashboard asks to complete the profile", async () => {
  await page.getByTestId("complete-profile").getByText("Complete your profile").waitFor();
  await page.getByTestId("complete-profile").getByRole("link", { name: "Add what you play or do" }).waitFor();
});

// A team's admins see who hasn't said.
const team = await api(lead, "POST", "/teams", { name: `Prompt ${tag}` });
const link = await api(lead, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
const joined = await call(newcomer, "POST", `/teams/join/${link.token}`);
check("(joins the team by its link)", joined.status === 201 || joined.status === 200, String(joined.status));
check("joining a team asks again", (await api(newcomer, "GET", "/users/me")).askProfile === true);

await step("asked again on the next visit, after joining", async () => {
  await page.goto(`${WEB}/teams/${team.id}`);
  await page.getByTestId("profile-prompt").getByText("What do you play or do?").waitFor();
});
await step("ticking what they play and saving", async () => {
  const prompt = page.getByTestId("profile-prompt");
  await prompt.getByRole("button", { name: "Acoustic guitar", exact: true }).click();
  await prompt.getByRole("button", { name: "Lead vocals", exact: true }).click();
  await page.getByTestId("profile-prompt-save").click();
  await prompt.waitFor({ state: "hidden" });
});
me = await api(newcomer, "GET", "/users/me");
check("…saves it to their profile", me.instruments.includes("ACOUSTIC_GUITAR") && me.instruments.includes("LEAD_VOCALS") && me.askProfile === false, JSON.stringify(me.instruments));
await step("…and the dashboard's card is gone", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: /Welcome back/ }).waitFor();
  if (await page.getByTestId("complete-profile").count()) throw new Error("still asks");
});

// The team's admin: who hasn't said yet.
const lateMember = await user("Silent Prompt");
await call(lateMember, "POST", `/teams/join/${link.token}`);
const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await adminContext.newPage();
await signIn(page, lead);
await step("a team's admin sees who hasn't said what they play", async () => {
  await page.goto(`${WEB}/teams/${team.id}`);
  await page.getByText("Silent Prompt", { exact: true }).waitFor();
  const row = page.locator("li", { hasText: "Silent Prompt" });
  await row.getByTestId("member-no-roles").waitFor();
  const newcomerRow = page.locator("li", { hasText: "Newcomer Prompt" });
  if (await newcomerRow.getByTestId("member-no-roles").count()) throw new Error("someone who said is listed");
});
await browser.close();
void stamp;
finish();
