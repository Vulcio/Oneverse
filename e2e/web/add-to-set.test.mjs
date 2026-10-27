// Adding a song to a set from the song (Add to set) and by dragging it from the library onto a set in the sidebar (issue #330).
import { chromium } from "playwright";
import { api, finish, signIn, sql, stamp, stepper, tag, user, WEB } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const leader = await user("Leader");
const team = await api(leader, "POST", "/teams", { name: `Add Team ${tag}` });
const grace = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `Grace ${tag}`, language: "en" });
const mercy = await api(leader, "POST", "/song-versions", { artists: ["Test Artist"], title: `Mercy ${tag}`, language: "en" });
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const sunday = await api(leader, "POST", "/setlists", { name: `Sunday ${tag}`, eventDate: isoDate(4) });
const rehearsal = await api(leader, "POST", "/setlists", { name: `Rehearsal ${tag}` });
const youth = await api(leader, "POST", "/setlists", { name: `Youth ${tag}` });
const teamSet = await api(leader, "POST", "/setlists", { name: `Team service ${tag}`, eventDate: isoDate(6), teamId: team.id });
const old = await api(leader, "POST", "/setlists", { name: `Old ${tag}`, eventDate: isoDate(1) });
sql(`update "Setlist" set "eventDate"='${isoDate(-4)}' where id='${old.id}'`);
const songsOf = async (set) => (await api(leader, "GET", `/setlists/${set.id}`)).items.map((item) => item.song?.id);

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const choice = (set) => page.locator(`[data-testid="add-to-set-choice"][data-set-id="${set.id}"]`);

await step("Add to set in Practice lists upcoming and undated sets, not past ones", async () => {
  await signIn(page, leader);
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${grace.id}`);
  await page.getByTestId("practice-song").waitFor();
  await page.getByTestId("add-to-set").click();
  await choice(sunday).waitFor();
  await choice(rehearsal).waitFor();
  if ((await choice(old).count()) !== 0) throw new Error("a past set is offered");
  // One's own song in a team's set: shared with the team as it's added (issue #331).
  if ((await choice(teamSet).getAttribute("data-state")) !== "addable") throw new Error("a team set doesn't take one's own song");
});

await step("picking a set adds the song at its end and ticks it", async () => {
  await choice(sunday).click();
  await page.locator(`[data-testid="add-to-set-choice"][data-set-id="${sunday.id}"][data-state="in"]`).waitFor();
  await choice(sunday).getByText("Already in it").waitFor();
  if (!(await songsOf(sunday)).includes(grace.id)) throw new Error("not in the set");
  await page.keyboard.press("Escape");
});

await step("one's own song into a team's set: shared with the team first (issue #331)", async () => {
  await page.getByTestId("add-to-set").click();
  await choice(teamSet).click();
  const ask = page.getByTestId("set-team-access");
  await ask.getByText(`Share Grace ${tag} with Add Team ${tag}?`).waitFor();
  await ask.getByRole("button", { name: `Share with Add Team ${tag}` }).click();
  await ask.waitFor({ state: "detached" });
  if (!(await songsOf(teamSet)).includes(grace.id)) throw new Error("not in the team's set");
  const teams = await api(leader, "GET", `/song-versions/${grace.id}/shares/teams`);
  if (teams[0]?.team.id !== team.id) throw new Error(JSON.stringify(teams));
  await page.getByTestId("add-to-set").click();
  await page.locator(`[data-testid="add-to-set-choice"][data-set-id="${teamSet.id}"][data-state="in"]`).waitFor();
  await page.keyboard.press("Escape");
});

await step("Add to set in Edit, then New set with this song", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.reload();
  await page.getByTestId("add-to-set").click();
  await page.locator(`[data-testid="add-to-set-choice"][data-set-id="${sunday.id}"][data-state="in"]`).waitFor();
  await page.getByTestId("add-to-new-set").click();
  await page.waitForURL("**/sets/new?**");
  await page.getByLabel("Name (optional)").fill(`Fresh ${tag}`);
  await page.getByRole("button", { name: "Create set" }).click();
  await page.waitForURL(/\/sets\/(?!new)[^/?]+$/);
  await page.getByTestId("set-song-row").filter({ hasText: `Grace ${tag}` }).waitFor();
});

await step("dragging a library song onto a set in the sidebar adds it", async () => {
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`Grace ${tag}`)}`);
  const row = page.getByTestId("library-song-row").filter({ hasText: `Grace ${tag}` });
  await row.waitFor();
  const entry = (name) => page.locator('[data-slot="sidebar"] [data-drop-state]').filter({ hasText: name });
  // Started by hand, so the sets can be checked before the drop.
  await row.hover();
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 4 });
  await page.getByTestId("set-drop-hint").waitFor();
  await page.locator('[data-slot="sidebar"] [data-drop-state="addable"]').filter({ hasText: `Rehearsal ${tag}` }).waitFor();
  const states = { sunday: await entry(`Sunday ${tag}`).getAttribute("data-drop-state"), team: await entry(`Team service ${tag}`).getAttribute("data-drop-state") };
  if (states.sunday !== "in" || states.team !== "in") throw new Error(JSON.stringify(states));
  const box = await entry(`Rehearsal ${tag}`).boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId("set-drop-notice").getByText(`Grace ${tag} added to Rehearsal ${tag}`).waitFor();
  if (!(await songsOf(rehearsal)).includes(grace.id)) throw new Error("not in the set");
  // The sidebar is itself again.
  await page.getByTestId("set-drop-hint").waitFor({ state: "detached" });
  if ((await page.locator("[data-drop-state]").count()) !== 0) throw new Error("sets still marked as drop targets");
});

await step("one's own song dropped on a team's set: asked first, then moved to the team", async () => {
  await page.goto(`${WEB}/library/songs?q=${encodeURIComponent(`Mercy ${tag}`)}`);
  const row = page.getByTestId("library-song-row").filter({ hasText: `Mercy ${tag}` });
  await row.waitFor();
  await row.hover();
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 4 });
  const target = page.locator('[data-slot="sidebar"] [data-drop-state="addable"]').filter({ hasText: `Team service ${tag}` });
  await target.waitFor();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const ask = page.getByTestId("set-team-access");
  await ask.getByRole("button", { name: `Move to Add Team ${tag}` }).click();
  await page.getByTestId("set-drop-notice").getByText(`Mercy ${tag} added to Team service ${tag}`).waitFor();
  const after = await api(leader, "GET", `/song-versions/${mercy.id}`);
  if (after.ownerScope !== "TEAM" || !(await songsOf(teamSet)).includes(mercy.id)) throw new Error(JSON.stringify({ scope: after.ownerScope }));
});

await step("Ctrl+K: Add to set on a song found", async () => {
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill(`Grace ${tag}`);
  const row = page.getByRole("option", { name: new RegExp(`Grace ${tag}`) }).first();
  await row.getByTestId("search-add-to-set").click();
  await choice(youth).click();
  await page.locator(`[data-testid="add-to-set-choice"][data-set-id="${youth.id}"][data-state="in"]`).waitFor();
  if (!(await songsOf(youth)).includes(grace.id)) throw new Error("not in the set");
  // Still searching: the song wasn't opened.
  await page.getByRole("combobox").waitFor();
  if (page.url().includes(`/library/${grace.id}`)) throw new Error("the song was opened");
});

await step("Edit on a narrower screen: Add to set from More", async () => {
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.goto(`${WEB}/library/${grace.id}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByTestId("menu-add-to-set").click();
  await page.locator(`[data-testid="add-to-set-choice"][data-set-id="${youth.id}"][data-state="in"]`).waitFor();
});

await browser.close();
finish();
