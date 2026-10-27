// A song and a team in the browser (issue #331): sharing it with the team
// from Share, what a member sees; moving it to the team from Share, offered
// by a member and accepted by an admin from the home page; adding one's own
// song to the team's set, shared with the team as it's added.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, tag, user, showStatusColumn } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const leader = await user("Leader");
const singer = await user("Singer");
const team = await api(leader, "POST", "/teams", { name: `Choir ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('sts${stamp}', '${team.id}', '${singer.id}', 'MEMBER', now(), now())`);
const song = async (who, title) => api(who, "POST", "/song-versions", { title, language: "en", artists: ["Band"], content: "{start_of_verse}\n[G]Line\n{end_of_verse}\n" });
const shared = await song(singer, `Shared with the choir ${tag}`);
const offered = await song(singer, `Offered to the choir ${tag}`);
const mine = await song(leader, `Leader's own ${tag}`);
const teamSet = await api(leader, "POST", "/setlists", { name: `Choir night ${tag}`, teamId: team.id });

const browser = await chromium.launch();
const pageFor = async (who) => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signIn(p, who);
  return p;
};
const leaderPage = await pageFor(leader);
const singerPage = await pageFor(singer);

await step("a member shares their song with the team from Share", async () => {
  page = singerPage;
  await page.goto(`${WEB}/library/${shared.id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("It isn't shared with anyone yet.").waitFor();
  await dialog.getByLabel("Share with").selectOption({ label: `Choir ${tag}` });
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await dialog.getByTestId("song-shares").getByText(`Choir ${tag}`, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
});

await step("the team's admin finds it in their library, shared with the team", async () => {
  page = leaderPage;
  await showStatusColumn(page);
  await page.goto(`${WEB}/library?q=${encodeURIComponent(`Shared with the choir ${tag}`)}`);
  await page.getByRole("row").filter({ hasText: `Shared with the choir ${tag}` }).getByText(`Shared with Choir ${tag}`).waitFor();
  await page.goto(`${WEB}/library/${shared.id}`);
  await page.getByText(`Shared with Choir ${tag} by Singer · you can view it`).waitFor();
});

await step("a member offers a song to the team from Share", async () => {
  page = singerPage;
  await page.goto(`${WEB}/library/${offered.id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Team to move it to").selectOption({ label: `Choir ${tag}` });
  await dialog.getByTestId("song-move-start").click();
  await dialog.getByText(`Move Offered to the choir ${tag} to Choir ${tag}?`).waitFor();
  await dialog.getByRole("button", { name: "Offer it" }).click();
  await dialog.getByText(`Offered to Choir ${tag}'s admins`).waitFor();
  await page.keyboard.press("Escape");
});

await step("the admin accepts it from the home page; it's the team's", async () => {
  page = leaderPage;
  await page.goto(`${WEB}/dashboard`);
  const card = page.getByTestId("ownership-requests");
  const offer = card.getByRole("listitem").filter({ hasText: `Singer offers Offered to the choir ${tag} to Choir ${tag}` });
  await offer.getByRole("button", { name: "Accept" }).click();
  await offer.waitFor({ state: "detached" });
  const after = await api(leader, "GET", `/song-versions/${offered.id}`);
  if (after.ownerScope !== "TEAM" || after.ownerTeamId !== team.id) throw new Error(JSON.stringify({ scope: after.ownerScope }));
});

await step("adding one's own song to the team's set shares it with the team", async () => {
  page = leaderPage;
  await page.goto(`${WEB}/sets/${teamSet.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("Search by title, artist, number or CCLI…").fill(`Leader's own ${tag}`);
  await page.getByTestId("set-song-results").getByRole("listitem").filter({ hasText: `Leader's own ${tag}` }).getByRole("button", { name: "Add" }).click();
  await page.getByTestId("set-team-access").getByRole("button", { name: `Share with Choir ${tag}` }).click();
  await page.getByTestId("set-song-row").filter({ hasText: `Leader's own ${tag}` }).waitFor();
  const teams = await api(leader, "GET", `/song-versions/${mine.id}/shares/teams`);
  if (teams[0]?.team.id !== team.id) throw new Error(JSON.stringify(teams));
});

await browser.close();
finish();
