// From signing up to sharing a set with one's team (issue #350), as two new
// people would: the band's leader on a phone, signing up, guided by Getting
// started, making a team and a song, sharing it, planning the team's set;
// a bandmate on a computer joining by the team's link (signing up there) and
// reading the set and its song. Every step through the app, no API shortcut.
import { chromium } from "playwright";
import { API, WEB, check, finish, logOffset, sql, stamp, stepper, tag, waitForLog } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const VERIFY = new RegExp(`${API.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/auth/verify-email\\?token=[^\\s]+`);
const email = (who) => `e2e-journey-${who}-${stamp}@example.com`;

/** Signs up on the open sign-up form, then follows the emailed link, as someone would. */
async function signUp(who, name) {
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.fill("#signup-name", name);
  await page.fill("#signup-email", email(who));
  await page.fill("#signup-password", "hunter2pass");
  const offset = logOffset();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Check your email").waitFor();
  const [link] = await waitForLog(offset, VERIFY);
  await page.goto(link);
  await page.waitForURL(`${WEB}/**`);
  await page.waitForLoadState("networkidle");
}

const browser = await chromium.launch();
const leadContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mateContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await leadContext.newPage();
const songTitle = `Journey song ${tag}`;
const teamName = `Journey band ${tag}`;
const setName = `Sunday ${tag}`;

await step("the leader signs up and lands in Songverse, asked what they play", async () => {
  await page.goto(WEB);
  await page.waitForLoadState("networkidle");
  await signUp("lead", "Journey Lead");
  if (!page.url().startsWith(`${WEB}/library`)) throw new Error(page.url());
  const prompt = page.getByTestId("profile-prompt");
  await prompt.getByText("What do you play or do?").waitFor();
  await prompt.getByRole("button", { name: "Lead vocals", exact: true }).click();
  await page.getByTestId("profile-prompt-save").click();
  await prompt.waitFor({ state: "hidden" });
});

await step("an empty library, with Getting started's three steps", async () => {
  const card = page.getByTestId("getting-started");
  await card.getByText("Getting started").waitFor();
  for (const key of ["song", "team", "set"]) {
    if ((await card.locator(`[data-step="${key}"]`).getAttribute("data-done")) !== "false") throw new Error(`${key} done already`);
  }
});

await step("Create a team, from Getting started", async () => {
  await page.getByTestId("getting-started").getByRole("link", { name: "Create a team" }).click();
  await page.waitForURL("**/teams/new");
  await page.getByLabel("Name", { exact: true }).fill(teamName);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.waitForURL(/\/teams\/(?!new)[^/]+$/);
  await page.getByRole("heading", { name: teamName }).waitFor();
  if ((await page.getByTestId("team-your-role").getAttribute("data-role")) !== "ADMIN") throw new Error("not told they're its admin");
});

let inviteUrl;
await step("an invite link for the band", async () => {
  await page.getByTestId("invite-link-create").click();
  inviteUrl = (await page.getByTestId("invite-link-url").first().textContent())?.trim();
  if (!inviteUrl?.includes("/join/")) throw new Error(String(inviteUrl));
});

await step("Add a song, from Getting started: private until shared", async () => {
  await page.goto(`${WEB}/library`);
  await page.getByTestId("getting-started").locator('[data-step="team"][data-done="true"]').waitFor();
  await page.getByTestId("getting-started").getByRole("link", { name: "Add a song" }).click();
  await page.waitForURL("**/library/new**");
  await page.fill("#song-title", songTitle);
  await page.click("#song-artists");
  await page.keyboard.type("The Band;");
  await page.fill("#song-content", "[G]Here we [D]go\n[Em]All to[C]gether");
  await page.getByRole("button", { name: "Save song" }).last().click();
  await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
  await page.getByRole("heading", { name: songTitle }).getByTestId("private-mark").waitFor();
});

await step("Share it with the team: no longer private", async () => {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Share with").selectOption({ label: teamName });
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await dialog.getByTestId("song-shares").getByText(teamName, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("heading", { name: songTitle }).waitFor();
  if (await page.getByRole("heading", { name: songTitle }).getByTestId("private-mark").count()) throw new Error("still marked private");
});

let setUrl;
await step("Plan the team's set, from Getting started, and add the song", async () => {
  await page.goto(`${WEB}/library`);
  await page.getByTestId("getting-started").getByRole("link", { name: "New set" }).click();
  await page.waitForURL("**/sets/new**");
  await page.fill("#set-name", setName);
  await page.selectOption("#set-owner", { label: teamName });
  await page.getByRole("button", { name: "Create set" }).click();
  await page.waitForURL(/\/sets\/(?!new)[^/]+$/);
  setUrl = page.url();
  await page.getByLabel("Search by title, artist, number or CCLI…").fill(songTitle);
  await page.getByTestId("set-song-results").getByRole("listitem").filter({ hasText: songTitle }).getByRole("button", { name: "Add" }).click();
  await page.getByRole("link", { name: songTitle }).first().waitFor();
});

await step("Getting started is done, and gone", async () => {
  await page.goto(`${WEB}/library`);
  await page.getByRole("heading", { name: "Library" }).waitFor();
  await page.waitForLoadState("networkidle");
  if (await page.getByTestId("getting-started").count()) throw new Error("still shown");
});

// The bandmate: the link, signed out; signs up there and joins.
page = await mateContext.newPage();
await step("the bandmate opens the team's link and signs up there", async () => {
  await page.goto(inviteUrl);
  await page.waitForLoadState("networkidle");
  await signUp("mate", "Journey Mate");
  // Asked what they play: later.
  await page.getByTestId("profile-prompt-skip").click();
  await page.getByTestId("profile-prompt").waitFor({ state: "hidden" });
});

await step("…and is in the team, told what a member does", async () => {
  // Wherever the link brought them, the team is theirs now.
  await page.goto(`${WEB}/teams`);
  await page.getByRole("link", { name: teamName }).first().click();
  await page.getByRole("heading", { name: teamName }).waitFor();
  if ((await page.getByTestId("team-your-role").getAttribute("data-role")) !== "MEMBER") throw new Error("not told they're a member");
});
check("(signed up through the link, they're in the team)", sql(`select count(*) from "TeamMembership" m join "User" u on u.id = m."userId" join "Team" t on t.id = m."teamId" where u.email = '${email("mate")}' and t.name = '${teamName}'`) === "1");

await step("the team's set and its song are there for them", async () => {
  await page.goto(setUrl);
  await page.getByRole("heading", { name: setName }).waitFor();
  await page.getByRole("link", { name: songTitle }).first().click();
  await page.getByText("Here we").first().waitFor();
});

await step("the song is in their library, shared with the team", async () => {
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(songTitle)}`);
  await page.getByRole("row").filter({ hasText: songTitle }).first().waitFor();
});

await browser.close();
finish();
