// Browser test for song fields and required artists.
import { chromium } from "playwright";
import { WEB, SP, stamp, tag, sql, stepper, user, api, signIn, finish } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// Fixtures
const me = await user("Song Editor");
const other = await user("Viewer");
const base = await api(me, "POST", "/song-versions", {
  artists: ["Chris Tomlin"],
  composers: ["John Newton"],
  title: `Amazing Grace ${tag}`,
  language: "en",
  key: "G",
  tempo: 70,
  content: "{start_of_verse}\n[G]Amazing grace\n{end_of_verse}",
});
const TITLE = `Amazing Grace ${tag}`;

function wav() {
  const samples = 800;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}
const noOverflow = async () => {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (sw > iw) throw new Error(`page scrolls sideways: ${sw} > ${iw}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await signIn(page, me);

let songId;
await step("add page shows the tabs and basic information", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Add a song" }).waitFor();
  for (const name of ["Song info", "Editor", "Files", "Audio", "Links"]) await page.getByRole("tab", { name }).waitFor();
  await page.screenshot({ path: `${SP}/editor-new-empty.png`, fullPage: true });
});

await step("saving empty shows what's required", async () => {
  await page.getByRole("button", { name: "Save song" }).click();
  await page.getByText("A song needs a name.").waitFor();
  await page.getByText("A song needs at least one artist.").waitFor();
});

await step("a title already in the library shows the match panel", async () => {
  await page.fill("#song-title", TITLE);
  await page.getByTestId("library-match").waitFor({ timeout: 5000 });
  await page.getByTestId("library-match").getByText("Chris Tomlin").first().waitFor();
  await page.screenshot({ path: `${SP}/editor-match.png`, fullPage: true });
  await page.getByRole("button", { name: "Not the same song" }).click();
  await page.getByTestId("library-match").waitFor({ state: "detached" });
});

await step("artist autocomplete suggests people already credited, with roles", async () => {
  await page.click("#song-artists");
  await page.keyboard.type("Chris");
  const option = page.getByRole("option", { name: /Chris Tomlin/ });
  await option.waitFor();
  if (!(await option.textContent()).includes("Artist")) throw new Error(await option.textContent());
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Louie Giglio;");
  await page.getByRole("button", { name: "Remove Chris Tomlin" }).waitFor();
  await page.getByRole("button", { name: "Remove Louie Giglio" }).waitFor();
});

await step("more details starts collapsed, then takes every field", async () => {
  await page.getByTestId("details-summary").getByText("English", { exact: true }).waitFor();
  await page.getByRole("button", { name: /More details/ }).click();
  await page.click("#song-composers");
  await page.keyboard.type("John");
  await page.getByRole("option", { name: /John Newton/ }).click();
  await page.selectOption("#song-key", "D");
  await page.fill("#song-tempo", "abc");
  await page.selectOption("#song-timeSignature", "3/4");
  await page.selectOption("#song-capo", "2");
  await page.fill("#song-year", "2006");
  await page.fill("#song-isrc", "USRC17607839");
  await page.fill("#song-ccli", "4768151");
  await page.click("#song-tags");
  await page.keyboard.type("Chris");
  await page.getByRole("option", { name: "Christmas" }).click();
  await page.fill("#song-notes", "Slow intro");
});

await step("a bad tempo is caught before saving", async () => {
  await page.getByRole("button", { name: "Save song" }).click();
  await page.getByText("Tempo is a number of beats per minute").waitFor();
  await page.fill("#song-tempo", "72");
});

await step("collapsed details show a summary", async () => {
  await page.getByRole("button", { name: /More details/ }).click();
  const summary = page.getByTestId("details-summary");
  for (const chip of ["Key D", "72 BPM", "3/4", "Suggested capo 2", "Christmas", "CCLI 4768151", "Composer: John Newton"]) {
    await summary.getByText(chip, { exact: true }).waitFor({ timeout: 3000 });
  }
});

await step("a source file fills the text box and is kept", async () => {
  await page.getByTestId("source-file-input").setInputFiles({ name: "grace.cho", mimeType: "text/plain", buffer: Buffer.from("{soc}\n[D]My chains are gone\n{eoc}\n") });
  await page.waitForFunction(() => document.querySelector("#song-content")?.value.includes("My chains"));
  await page.getByText("Also keep this file under Files").waitFor();
  await page.getByText(/Detected: ChordPro/).waitFor();
});

await step("pasted chords over lyrics are detected, and the format can be set", async () => {
  await page.fill("#song-content", "Verse 1\nD          G\nAmazing grace how sweet\nA          D\nThat saved a wretch\n");
  await page.getByText("Detected: Chords over lyrics (high confidence)").waitFor();
  await page.getByText(/5 lines/).waitFor();
  await page.getByRole("radio", { name: "Lyrics only" }).click();
  await page.getByText("Format set by you.").waitFor();
  await page.getByRole("button", { name: "Detect it again" }).click();
  await page.getByText(/Detected: Chords over lyrics/).waitFor();
  await page.screenshot({ path: `${SP}/editor-new-filled.png`, fullPage: true });
});

await step("the Editor tab edits the same chart, chords over the lyrics", async () => {
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.waitForURL(/tab=editor/);
  const editor = page.getByTestId("structured-editor");
  await editor.locator('[data-sv-chord="G"] .sv-chord-chip').first().waitFor();
  const lyrics = await editor.locator("p[data-sv-line]").first().evaluate((p) => [...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join(""));
  if (!lyrics.includes("Amazing grace how sweet")) throw new Error(lyrics);
  // A new line at the end, with a chord typed in.
  await editor.locator("p[data-sv-line]").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[D]Amazing love");
  await editor.locator('[data-sv-chord="D"] .sv-chord-chip').last().waitFor();
  await page.screenshot({ path: `${SP}/editor-tab.png`, fullPage: true });
  await page.getByRole("radio", { name: "Preview" }).click();
  await page.locator('[data-chord="D"]').first().waitFor();
  await page.getByRole("tab", { name: "Song info" }).click();
  if (!(await page.inputValue("#song-content")).includes("[D]Amazing love")) throw new Error("the chart isn't shared with Song info");
});

await step("files wait for the song to be saved", async () => {
  await page.getByRole("tab", { name: "Files" }).click();
  await page.getByText("Save the song first").waitFor();
  await page.getByRole("tab", { name: "Song info" }).click();
});

await step("leaving with unsaved changes asks first", async () => {
  await page.getByRole("link", { name: "Library" }).first().click();
  await page.getByRole("heading", { name: "Leave without saving?" }).waitFor();
  await page.getByRole("button", { name: "Keep editing" }).click();
  if (!page.url().includes("/library/new")) throw new Error(page.url());
});

await step("saving creates the song with everything", async () => {
  await page.getByRole("button", { name: "Save song" }).click();
  await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
  songId = page.url().split("/library/")[1].split("?")[0];
  await page.getByRole("heading", { name: TITLE }).waitFor();
  const d = await api(me, "GET", `/song-versions/${songId}`);
  const roles = Object.fromEntries(d.contributors.map((c) => [c.source, c.roles.sort().join()]));
  const ok =
    d.artists.map((a) => a.source).join() === "Chris Tomlin,Louie Giglio" &&
    roles["John Newton"] === "COMPOSER" &&
    d.documentJson.defaults.key === "D" && d.documentJson.defaults.tempo === 72 && d.capo === 2 &&
    d.documentJson.defaults.timeSignature?.numerator === 3 && d.year === 2006 && d.isrc === "USRC17607839" && d.ccli === "4768151" &&
    d.notes === "Slow intro" && d.tags[0]?.label === "Christmas" &&
    d.documentJson.sections[0]?.lines.some((l) => l.chords.some((c) => c.raw === "G"));
  if (!ok) throw new Error(JSON.stringify({ artists: d.artists, roles, defaults: d.documentJson.defaults, year: d.year, tags: d.tags }));
  const files = await api(me, "GET", `/song-versions/${songId}/attachments`);
  if (files.length !== 1 || files[0].filename !== "grace.cho" || files[0].type !== "CHORDPRO") throw new Error(JSON.stringify(files));
});

await step("the song opens in the same editor, filled in", async () => {
  if ((await page.inputValue("#song-title")) !== TITLE) throw new Error("title");
  await page.getByRole("button", { name: "Remove Louie Giglio" }).waitFor();
  await page.getByTestId("details-summary").getByText("Key D", { exact: true }).waitFor();
  // Its chart is in the Editor; Song info's Song content is for a new song (issue #254).
  if (await page.locator("#song-content").count()) throw new Error("Song content shown for a song that exists");
  await page.getByRole("tab", { name: /Files/ }).getByText("1").waitFor();
  await page.screenshot({ path: `${SP}/editor-edit.png`, fullPage: true });
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.getByTestId("structured-editor").getByText("Amazing love").waitFor();
});

await step("the chart replaced from the Editor, pasted in", async () => {
  await page.getByTestId("editor-replace").click();
  const dialog = page.getByTestId("replace-chart");
  await dialog.locator("#song-content").fill("{start_of_chorus}\n[G]Bless the [C]Lord, O my soul\n{end_of_chorus}\n");
  await dialog.getByText(/Detected: ChordPro/).waitFor();
  await page.getByTestId("replace-chart-confirm").click();
  // Its words, around the chords pinned in them.
  await page.getByTestId("structured-editor").getByText(/Lord, O my soul/).waitFor();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByTestId("structured-editor").getByText("Amazing love").waitFor();
  await page.getByRole("tab", { name: "Song info" }).click();
});

await step("editing: remove an artist, save", async () => {
  await page.getByRole("button", { name: "Remove Louie Giglio" }).click();
  await page.getByRole("button", { name: "Save song" }).click();
  await page.getByText("Saved.").waitFor();
  const d = await api(me, "GET", `/song-versions/${songId}`);
  if (d.artists.map((a) => a.source).join() !== "Chris Tomlin") throw new Error(JSON.stringify(d.artists));
  // "Saved." shows as the saved song reloads; Save turns disabled once the form has it.
  await page.getByRole("button", { name: "Save song" }).and(page.locator(":disabled")).waitFor({ timeout: 5000 }).catch(() => {
    throw new Error("save should be disabled when nothing changed");
  });
});

await step("a song that still has a variant name from before shows it; the form has no field for it (#78)", async () => {
  await api(me, "PATCH", `/song-versions/${songId}`, { versionName: "Live" });
  await page.reload();
  await page.locator("h1").getByText("Live", { exact: true }).waitFor();
  await page.getByRole("button", { name: /More details/ }).click();
  if (await page.locator("#song-versionName").count()) throw new Error("a version name field");
});

await step("discard puts the saved values back", async () => {
  await page.fill("#song-title", "Something else");
  await page.getByRole("button", { name: "Discard changes" }).click();
  if ((await page.inputValue("#song-title")) !== TITLE) throw new Error("not restored");
});

await step("audio: upload a recording and play it", async () => {
  await page.getByRole("tab", { name: "Audio" }).click();
  await page.getByTestId("audio-input").setInputFiles({ name: "rehearsal.wav", mimeType: "audio/wav", buffer: wav() });
  await page.getByTestId("audio-list").getByText("rehearsal.wav").waitFor();
  await page.getByRole("button", { name: "Play" }).click();
  await page.locator("audio").waitFor({ state: "attached" });
  await page.getByRole("tab", { name: /Audio/ }).getByText("1").waitFor();
  await page.screenshot({ path: `${SP}/editor-audio.png`, fullPage: true });
});

await step("files tab lists the kept source file, not the audio", async () => {
  await page.getByRole("tab", { name: /Files/ }).click();
  await page.getByTestId("files-list").getByText("grace.cho").waitFor();
  if (await page.getByTestId("files-list").getByText("rehearsal.wav").count()) throw new Error("audio listed under files");
});

await step("links tab has streaming links and the MusicBrainz work", async () => {
  await page.getByRole("tab", { name: "Links" }).click();
  await page.getByLabel("Spotify", { exact: true }).waitFor();
  await page.getByText("MusicBrainz work").waitFor();
});

let newVersionId;
await step("link a new song to one from the match panel: an adaptation, in the same language (#78)", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.fill("#song-title", TITLE);
  const panel = page.getByTestId("library-match");
  await panel.waitFor({ timeout: 5000 });
  const card = panel.locator("div.rounded-md").filter({ hasText: "Live" }).first();
  await card.getByText("Or is this one a translation or adaptation of it?").waitFor();
  await card.getByRole("button", { name: "Link it to this song" }).click();
  await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
  newVersionId = page.url().split("/library/")[1].split("?")[0];
  const d = await api(me, "GET", `/song-versions/${newVersionId}`);
  const orig = await api(me, "GET", `/song-versions/${songId}`);
  if (d.workId !== orig.workId || d.parentVersion?.id !== songId || d.relationshipType !== "LYRICAL_ADAPTATION" || d.artists[0]?.source !== "Chris Tomlin") {
    throw new Error(JSON.stringify({ work: [d.workId, orig.workId], parent: d.parentVersion, relation: d.relationshipType, artists: d.artists }));
  }
  await page.getByText(`Adaptation of ${TITLE}`).waitFor();
  if (await page.getByLabel("Version name").count()) throw new Error("the version name field is still there");
});

await step("the original lists it under Translations and adaptations; Add a translation starts a song linked to it", async () => {
  await page.goto(`${WEB}/library/${songId}`);
  const linked = page.getByTestId("linked-songs");
  await linked.getByRole("link", { name: TITLE }).waitFor();
  await linked.getByText("Adaptation · English").waitFor();
  await linked.getByRole("link", { name: "Add a translation" }).click();
  await page.waitForURL(/\/library\/new\?linkTo=/);
  await page.getByText(`Saving as a translation or adaptation of “${TITLE}”, linked to it.`).waitFor();
});

await step("use as base copies the details", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.fill("#song-title", TITLE);
  const panel = page.getByTestId("library-match");
  await panel.waitFor({ timeout: 5000 });
  await panel.locator("div.rounded-md").filter({ hasText: "Live" }).first().getByRole("button", { name: "Use as base" }).first().click();
  await page.getByText(/Starting from/).waitFor();
  await page.getByRole("button", { name: "Remove Chris Tomlin" }).waitFor();
  if ((await page.inputValue("#song-key")) !== "D") throw new Error("key not copied");
  if (!(await page.inputValue("#song-content")).includes("Amazing love")) throw new Error("content not copied");
  await page.getByRole("button", { name: "Save song" }).click();
  await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
  const id = page.url().split("/library/")[1].split("?")[0];
  const d = await api(me, "GET", `/song-versions/${id}`);
  if (d.capo !== 2 || d.relationshipType !== "LYRICAL_ADAPTATION") throw new Error(JSON.stringify({ capo: d.capo, relation: d.relationshipType }));
});

await step("the library still shows a variant name from before", async () => {
  await page.goto(`${WEB}/library`);
  await page.waitForLoadState("networkidle");
  await page.getByText("— Live").first().waitFor();
  await page.screenshot({ path: `${SP}/editor-library.png`, fullPage: true });
});

await step("someone who can only view gets no editing", async () => {
  const team = await api(me, "POST", "/teams", { name: `Editors ${tag}` });
  sql(`insert into "TeamMembership"(id,"teamId","userId",role,"updatedAt") values ('tm${stamp}','${team.id}','${other.id}','MEMBER',now())`);
  const teamSong = await api(me, "POST", "/song-versions", { title: `Team song ${tag}`, language: "en", artists: ["Band"], teamId: team.id });
  const p2 = await context.browser().newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage());
  await signIn(p2, other);
  await p2.goto(`${WEB}/library/${teamSong.id}`);
  await p2.waitForLoadState("networkidle");
  await p2.getByText("You can view this song but not change it.").waitFor();
  if (await p2.getByRole("button", { name: "Save song" }).count()) throw new Error("save shown");
  if (!(await p2.locator("#song-title").isDisabled())) throw new Error("title editable");
  await p2.close();
});

await step("mobile: the add page stacks without sideways scrolling", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.fill("#song-title", TITLE);
  await page.getByTestId("library-match").waitFor({ timeout: 5000 });
  await noOverflow();
  await page.getByTestId("mobile-save-bar").waitFor();
  await page.screenshot({ path: `${SP}/editor-mobile-new.png`, fullPage: true });
});

await step("mobile: the song page and its tabs fit", async () => {
  // Nothing typed yet on the add page other than the title - leave it.
  await page.goto(`${WEB}/library/${songId}`);
  const dialog = page.getByRole("button", { name: "Leave" });
  if (await dialog.isVisible().catch(() => false)) await dialog.click();
  await page.waitForURL(new RegExp(songId));
  await page.waitForLoadState("networkidle");
  await noOverflow();
  // Always there (issue #248), Save disabled until there's something to save.
  await page.getByTestId("mobile-save-bar").getByText("All changes saved").waitFor();
  if (!(await page.getByTestId("mobile-save-bar").getByRole("button").isDisabled())) throw new Error("save enabled without changes");
  await page.fill("#song-title", "Changed");
  await page.locator("[data-testid=mobile-save-bar][data-dirty]").waitFor();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.screenshot({ path: `${SP}/editor-mobile-edit.png`, fullPage: true });
  await page.getByRole("tab", { name: "Editor" }).click();
  await noOverflow();
  await page.screenshot({ path: `${SP}/editor-mobile-editor.png`, fullPage: true });
});

await step("no page errors", async () => {
  const relevant = errors.filter((e) => !(e.includes("Hydration failed") && e.includes("Abkhazian")));
  if (relevant.length) throw new Error(relevant.join(" | "));
});

await browser.close();
finish();
