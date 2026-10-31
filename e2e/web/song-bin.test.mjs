// Deleting a song (issue #340): the dialog says where others use it and
// offers to give it to the team instead; deleted, it waits in the Bin,
// where it's put back or deleted for good.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const owner = await user("Bin owner");
const team = await api(owner, "POST", "/teams", { name: `Bin team ${stamp}` });
const given = await api(owner, "POST", "/song-versions", { title: `Given ${stamp}`, language: "en", artists: ["Bin Artist"] });
const binned = await api(owner, "POST", "/song-versions", { title: `Binned ${stamp}`, language: "en", artists: ["Bin Artist"] });
// Both in the team's set: others use them.
const set = await api(owner, "POST", "/setlists", { name: `Bin set ${stamp}`, teamId: team.id });
[given, binned].forEach((song, n) => sql(`insert into "SetlistItem" (id, "setlistId", "songVersionId", position, "transposeSteps", "updatedAt") values ('bi${n}${stamp}', '${set.id}', '${song.id}', ${n}, 0, now())`));

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, owner);

const openDelete = async (song) => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete song" }).click();
  await page.getByTestId("delete-song-usage").waitFor();
};

await step("the dialog shows the team's set and gives the song to the team", async () => {
  await openDelete(given);
  await page.getByTestId("delete-song-usage").getByText(`Bin set ${stamp}`).waitFor();
  await page.getByRole("button", { name: `Give it to Bin team ${stamp}` }).click();
  await page.getByText(`It's Bin team ${stamp}'s now.`).waitFor();
  const owned = sql(`select "ownerTeamId" from "SongVersion" where id='${given.id}'`);
  if (owned !== team.id) throw new Error(`not the team's: ${owned}`);
});

await step("moved to the bin, it's listed there; put back, it's in its set again", async () => {
  await openDelete(binned);
  await page.getByTestId("delete-song-confirm").click();
  await page.waitForURL(/\/library\/bin/);
  await page.getByTestId("bin-song").filter({ hasText: `Binned ${stamp}` }).waitFor();
  const items = (await call(owner, "GET", `/setlists/${set.id}`)).body.items;
  if (!items.some((item) => item.song === null)) throw new Error("the set lost its place");
  await page.getByTestId("bin-song").filter({ hasText: `Binned ${stamp}` }).getByRole("button", { name: "Put back" }).click();
  await page.getByText(`“Binned ${stamp}” is back.`).waitFor();
  const back = (await call(owner, "GET", `/setlists/${set.id}`)).body.items;
  if (!back.every((item) => item.song)) throw new Error("not back in its set");
});

await step("deleted for good from the bin, after confirming", async () => {
  await api(owner, "DELETE", `/song-versions/${binned.id}`);
  await page.goto(`${WEB}/library/bin`);
  const row = page.getByTestId("bin-song").filter({ hasText: `Binned ${stamp}` });
  await row.getByRole("button", { name: "Delete for good" }).click();
  await row.getByRole("button", { name: "Yes, with its files, versions and notes" }).click();
  await row.waitFor({ state: "detached" });
  if (sql(`select count(*) from "SongVersion" where id='${binned.id}'`) !== "0") throw new Error("still there");
});

await browser.close();
finish();
