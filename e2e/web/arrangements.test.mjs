// Browser test for arrangements (docs/arrangement-document-v2.md): making
// one from a song you can't edit, changing its key, capo, tempo, chords,
// lines and notes, making it the team's usual one, playing it in a set with
// a player's own view on top, and the song changing underneath it.
import { chromium } from "playwright";
import { WEB, SP, stamp, tag, sql, stepper, user, api, signIn, finish, displaySetting, resetDisplay } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// Fixtures: a global song (capo 3 suggested), a band and its team set.
const leader = await user("Band leader");
const player = await user("Guitarist");
const root = await user("Catalogue admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${root.id}'`);
const team = await api(leader, "POST", "/teams", { name: `Band ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmw${stamp}', '${team.id}', '${player.id}', 'MEMBER', now(), now())`);
const song = await api(leader, "POST", "/song-versions", {
  title: `Arranged Grace ${tag}`,
  language: "en",
  artists: ["Someone"],
  key: "G",
  capo: 3,
  content: "{start_of_verse}\n[G]Amazing grace how [D]sweet\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n",
  contentFormat: "CHORDPRO",
});
sql(`update "SongVersion" set "ownerScope"='GLOBAL', "ownerUserId"=null, "publicationState"='APPROVED' where id='${song.id}'`);

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const pass = (n) => page.locator("[data-pass-editor]").nth(n);
let editorUrl;

await step("a song you can't edit can be arranged, for yourself or a team you run", async () => {
  await signIn(page, leader);
  await page.goto(`${WEB}/library/${song.id}?tab=arrangements`);
  await page.waitForLoadState("networkidle");
  await page.getByText("No versions yet.").waitFor();
  await page.getByLabel("Name").fill("Sunday band");
  await page.getByLabel("For").selectOption({ label: `Band ${tag}` });
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/arrangements/**");
  await page.waitForLoadState("networkidle");
  editorUrl = page.url();
  await page.getByText(`Version of Arranged Grace ${tag} · Band ${tag}`).waitFor();
  await page.getByText("The song suggests capo 3.").waitFor();
  // It starts as the song: its order, in its key.
  await pass(0).locator('[data-arr-chord="G"]').waitFor();
  if ((await page.locator("[data-pass-editor]").count()) !== 2) throw new Error("expected the song's two passes");
});

await step("key, capo and tempo; chords are shown in the key it's played in", async () => {
  await page.getByLabel("Key").selectOption({ label: "A (+2)" });
  await pass(0).locator('[data-arr-chord="A"]').waitFor();
  await pass(0).locator('[data-arr-chord="E"]').waitFor();
  await page.getByLabel("Capo").selectOption("2");
  await page.getByText("The song suggests capo 3.").waitFor({ state: "detached" });
  await page.getByLabel("Tempo (BPM)").fill("92");
});

await step("replace a chord on one pass, hide another, add a line note", async () => {
  await pass(0).locator('[data-arr-chord="E"]').click();
  await page.getByText("E on this pass:").waitFor();
  await page.getByLabel("Replace with").fill("F#m");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await pass(0).locator('[data-arr-chord="F#m"]').waitFor();
  await pass(0).getByText("Changed in this version").waitFor();

  await pass(1).locator('[data-arr-chord="D"]').click();
  await page.getByRole("button", { name: "Hide for the band" }).click();

  await pass(0).getByRole("button", { name: "Note on this line" }).click();
  await pass(0).getByRole("textbox", { name: "Note on this line" }).fill("Softly");
  await page.getByRole("button", { name: "Set note" }).click();
  await pass(0).getByText("Softly").waitFor();
});

await step("save; it's all there after a reload", async () => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await pass(0).locator('[data-arr-chord="F#m"]').waitFor();
  await pass(0).getByText("Softly").waitFor();
  if ((await page.getByLabel("Tempo (BPM)").inputValue()) !== "92") throw new Error("tempo not saved");
  if ((await page.getByLabel("Capo").inputValue()) !== "2") throw new Error("capo not saved");
});

await step("make it the band's usual arrangement", async () => {
  await page.getByRole("button", { name: `Make it Band ${tag}'s usual` }).click();
  await page.getByText(`Now Band ${tag}'s usual version`).waitFor();
  await page.getByText("Usual", { exact: true }).waitFor();
  await page.screenshot({ path: `${SP}/arrangement-editor.png`, fullPage: true });
});

// A team set with the song: it's played in the usual arrangement.
const set = await api(leader, "POST", "/setlists", { name: `Arranged set ${tag}`, teamId: team.id });
await api(leader, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
const itemId = (await api(leader, "GET", `/setlists/${set.id}`)).items[0].id;

await step("a song added to the band's set plays its usual arrangement; it can be changed", async () => {
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  const select = page.getByTestId("set-song-row").getByLabel("Version");
  const selected = () => select.evaluate((el) => el.selectedOptions[0].textContent);
  if ((await selected()) !== "Sunday band (usual)") throw new Error(`arrangement: ${await selected()}`);
  await select.selectOption({ label: "As written" });
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.waitForLoadState("networkidle");
  if ((await selected()) !== "As written") throw new Error(`after switching: ${await selected()}`);
  await select.selectOption({ label: "Sunday band (usual)" });
  await page.waitForLoadState("networkidle");
});

const chord = (label) => page.locator(`[data-chord="${label}"]`);

await step("the set's chart is the arrangement: its key, capo, chords and notes", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${itemId}`);
  await page.waitForLoadState("networkidle");
  await page.getByText(/Played as Sunday band · 92 BPM/).waitFor();
  // The metronome at the arrangement's tempo too (issue #2).
  await page.getByTestId("metronome-song").getByText("92 BPM").waitFor();
  await page.getByTestId("capo").getByText("Capo 2 · chords shown as they sound").waitFor();
  await chord("F#m").first().waitFor();
  await page.getByText("Softly").waitFor();
  if ((await chord("D").count()) !== 0) throw new Error("the chord hidden for the band still shows");
  if ((await page.locator("[data-differs]").count()) !== 2) throw new Error("both passes should be marked as changed");
});

await step("a player reads it as capo shapes or in solfège", async () => {
  await displaySetting(page, "chords", "display-capo-FINGERED");
  await chord("Em").first().waitFor(); // F#m, two frets down
  await page.getByTestId("capo").getByText("chords shown as the shapes to play").waitFor();
  // Shapes, not what sounds: in italics (issue #219).
  const italic = await chord("Em").first().evaluate((element) => getComputedStyle(element).fontStyle);
  if (italic !== "italic" || !(await page.locator('[data-testid="song-chart"][data-capo-shapes]').count())) throw new Error(`shapes not in italics: ${italic}`);
  await displaySetting(page, "chords", "display-capo-SOUNDING");
  await page.locator('[data-testid="song-chart"][data-capo-shapes]').waitFor({ state: "detached" });
  await displaySetting(page, "chords", "display-notation-SOLFEGE");
  await chord("La").first().waitFor();
  // Back to the account's settings (letters, as they sound): the dashboard's, below, show again.
  await resetDisplay(page);
  await chord("A").first().waitFor();
});

await step("a player hides a chord for themselves only", async () => {
  await page.getByRole("button", { name: "Hide chords" }).click();
  await page.getByRole("button", { name: "Hide F♯m for me" }).click();
  await page.getByRole("button", { name: "Show 1 hidden chord" }).waitFor();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Show 1 hidden chord" }).waitFor();
  if ((await chord("F#m").count()) !== 0) throw new Error("hidden chord still shows after a reload");
  await page.screenshot({ path: `${SP}/arrangement-player.png`, fullPage: true });

  // Another player of the band still sees it.
  const other = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signIn(other, player);
  await other.goto(`${WEB}/sets/${set.id}/songs/${itemId}`);
  await other.waitForLoadState("networkidle");
  await other.locator('[data-chord="F#m"]').first().waitFor();
  await other.context().close();

  await page.getByRole("button", { name: "Show 1 hidden chord" }).click();
  await chord("F#m").first().waitFor();
});

await step("chord names and capo display are also set from the dashboard", async () => {
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Chord names").selectOption({ label: "Solfège (Do Ré Mi)" });
  await page.getByLabel("With a capo").selectOption({ label: "Shapes to play" });
  await page.waitForLoadState("networkidle");
  await page.goto(`${WEB}/sets/${set.id}/songs/${itemId}`);
  await page.waitForLoadState("networkidle");
  await chord("Mim").first().waitFor(); // F#m as capo 2 shapes (Em), in solfège
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Chord names").selectOption({ label: "Letters (C D E)" });
  await page.waitForLoadState("networkidle");
  await page.getByLabel("With a capo").selectOption({ label: "Chords as they sound" });
  await page.waitForLoadState("networkidle");
});

await step("the song's own capo is only a suggestion", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByText("Suggested capo 3").first().waitFor();
});

await step("when the song changes, the arrangement asks for a review and lists what no longer matches", async () => {
  // A global admin deletes the verse chord the arrangement replaced.
  const document = (await api(root, "GET", `/song-versions/${song.id}`)).documentJson;
  document.sections[0].lines[0].chords.splice(1, 1);
  await api(root, "PATCH", `/song-versions/${song.id}`, { sections: document.sections });

  await page.goto(editorUrl);
  await page.waitForLoadState("networkidle");
  const banner = page.getByTestId("review-banner");
  await banner.getByText("The song changed since this version was checked").waitFor();
  await banner.getByText("1 change refers to something since removed").waitFor();
  await pass(0).getByTestId("stale-changes").getByText("Chord replaced by F#m: that chord was removed from the song.").waitFor();

  await banner.getByRole("button", { name: "Mark as checked" }).click();
  await banner.getByText("Some changes no longer match the song").waitFor();
  await pass(0).getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();
  await banner.waitFor({ state: "detached" });
});

await step("delete it; the set plays the song as written", async () => {
  await page.getByRole("button", { name: "Delete version" }).click();
  await page.getByRole("button", { name: "Delete it for good" }).click();
  await page.waitForURL("**/library/**");
  await page.getByText("No versions yet.").waitFor();
  const item = (await api(leader, "GET", `/setlists/${set.id}`)).items[0];
  if (item.arrangement !== null) throw new Error("the set still points at the deleted arrangement");
});

await step("a song's order just for this set: repeat the chorus there only", async () => {
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("set-song-row").getByLabel("Version").selectOption({ label: "Just for this set…" });
  await page.waitForURL("**/arrangements/**");
  await page.waitForLoadState("networkidle");
  const back = page.getByRole("main").getByRole("link", { name: `Arranged set ${tag}` });
  await back.waitFor(); // back to the set
  await page.getByText(`just for Arranged set ${tag}`).waitFor();
  if ((await page.getByRole("button", { name: /usual/ }).count()) !== 0) throw new Error("a set's own arrangement can't be the band's usual one");
  await page.getByTestId("song-order").getByLabel("Add a pass").selectOption({ label: "Chorus" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();

  await back.click();
  await page.waitForURL(`**/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  const row = page.getByTestId("set-song-row");
  // Waited for: the row may show the set as it was a moment before.
  await row.getByLabel("Version").evaluate(
    (select) =>
      new Promise((resolve, reject) => {
        const end = Date.now() + 10000;
        const look = () => (select.selectedOptions[0]?.textContent === "Just for this set" ? resolve(true) : Date.now() > end ? reject(new Error("the set doesn't play it")) : setTimeout(look, 100));
        look();
      }),
  );
  await row.getByRole("link", { name: `Change Arranged Grace ${tag} for this set` }).waitFor();
  await page.screenshot({ path: `${SP}/set-only-arrangement.png` });
  await page.goto(`${WEB}/sets/${set.id}/songs/${itemId}`);
  await page.waitForLoadState("networkidle");
  await page.getByText("Played as Just for this set").waitFor();
  if ((await page.locator("[data-pass]").count()) !== 3) throw new Error(`expected 3 passes, got ${await page.locator("[data-pass]").count()}`);

  // The song's own list doesn't show it.
  await page.goto(`${WEB}/library/${song.id}?tab=arrangements`);
  await page.waitForLoadState("networkidle");
  await page.getByText("No versions yet.").waitFor();
});

await browser.close();
finish();
