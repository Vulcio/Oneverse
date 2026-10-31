// One's own song into a team's songbook (issue #340): asked first, then
// shared with the team, so its members can open it from the songbook.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Songbook admin");
const team = await api(admin, "POST", "/teams", { name: `Songbook team ${stamp}` });
const book = await api(admin, "POST", "/songbooks", { name: `Team book ${stamp}`, kind: "SIMPLE", teamId: team.id });
const song = await api(admin, "POST", "/song-versions", { title: `Mine ${stamp}`, language: "en", artists: ["Book Artist"] });

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, admin);

await step("adding one's own song asks, then shares it with the team", async () => {
  await page.goto(`${WEB}/songbooks/${book.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Add a song").fill(`Mine ${stamp}`);
  await page.getByRole("button", { name: `Mine ${stamp}` }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("songbook-team-access").waitFor();
  await page.getByTestId("songbook-team-access-share").click();
  await page.getByTestId("songbook-team-access").waitFor({ state: "detached" });
  await page.getByRole("link", { name: `Mine ${stamp}` }).first().waitFor();
  if (sql(`select count(*) from "AccessGrant" where "songVersionId"='${song.id}' and "grantedToTeamId"='${team.id}'`) !== "1") throw new Error("not shared");
  const entries = (await call(admin, "GET", `/songbooks/${book.id}`)).body.entries;
  if (entries.length !== 1) throw new Error(`${entries.length} entries`);
});

await browser.close();
finish();
