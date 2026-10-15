// Live collaboration, phase 2 (issue #27), with two or three people at once: who's editing a song (in the Editor and in Practice),
// a save made elsewhere said at once - loaded on a tap, or dropped edits only when asked - and "replying…" in a note's thread.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, tag, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

const owner = await user("Olivia Live");
const admin = await user("Ada Live");
const member = await user("Milo Live");
const team = await api(owner, "POST", "/teams", { name: `Live band ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('lca${stamp}', '${team.id}', '${admin.id}', 'ADMIN', now(), now()), ('lcm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const song = await api(owner, "POST", "/song-versions", { title: `Together ${tag}`, language: "en", artists: ["Someone"], teamId: team.id });
await api(owner, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]First words\n{end_of_verse}\n" });
const saveAs = (who, words) => api(who, "PATCH", `/song-versions/${song.id}`, { contentFormat: "CHORDPRO", content: `{start_of_verse}\n[G]${words}\n{end_of_verse}\n` });

const browser = await chromium.launch();
const errors = [];
const open = async (who, mode, url = `/library/${song.id}`) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  await signIn(p, who);
  await p.evaluate((m) => localStorage.setItem("songverse.mode", m), mode);
  await p.goto(`${WEB}${url}`);
  await p.waitForLoadState("networkidle");
  return p;
};

const editor = await open(owner, "edit", `/library/${song.id}?tab=editor`);
await editor.locator(".ProseMirror").waitFor();
const practice = await open(member, "practice");
await practice.getByTestId("song-chart").waitFor();
const prose = () => editor.locator(".ProseMirror");

page = practice;
await step("Practice says who's editing the song", async () => {
  const chip = practice.getByTestId("presence-editing");
  await chip.waitFor({ timeout: 5000 });
  if (!(await chip.textContent()).includes("Olivia Live is editing this song")) throw new Error(await chip.textContent());
  if ((await editor.getByTestId("presence-editing").count()) > 0) throw new Error("the editor says it's editing itself");
});

await step("a save made elsewhere: Practice offers to load it, the chart not moving by itself", async () => {
  await saveAs(admin, "Second words");
  await practice.getByTestId("song-changed").waitFor({ timeout: 5000 });
  if ((await practice.getByTestId("song-chart").getByText("Second words").count()) > 0) throw new Error("loaded by itself");
  await practice.getByTestId("song-changed").click();
  await practice.getByTestId("song-chart").getByText("Second words").waitFor();
  await practice.getByTestId("song-changed").waitFor({ state: "detached" });
});

page = editor;
await step("…the Editor too: Load it, nothing of its own to lose", async () => {
  const notice = editor.getByTestId("saved-elsewhere");
  await notice.waitFor({ timeout: 5000 });
  if (!(await notice.textContent()).includes("Ada Live saved this song.")) throw new Error(await notice.textContent());
  await editor.getByTestId("saved-elsewhere-load").click();
  await prose().getByText("Second words").waitFor();
  await notice.waitFor({ state: "detached" });
});

await step("with edits of its own: saying they'd be dropped, and dropped only when asked", async () => {
  await prose().getByText("Second words").click();
  await editor.keyboard.press("End");
  await editor.keyboard.type(" mine");
  await saveAs(admin, "Third words");
  const notice = editor.getByTestId("saved-elsewhere");
  await notice.waitFor({ timeout: 5000 });
  if (!(await notice.textContent()).includes("Your changes here aren't saved")) throw new Error(await notice.textContent());
  // Keep editing: then saving is refused, and said the same way (not the server's English).
  await editor.getByTestId("saved-elsewhere-dismiss").click();
  await editor.getByRole("button", { name: "Save song" }).first().click();
  await notice.waitFor({ timeout: 5000 });
  if (!(await notice.textContent()).includes("This song was saved somewhere else since you opened it.")) throw new Error(await notice.textContent());
  await editor.getByTestId("saved-elsewhere-load").click();
  await prose().getByText("Third words").waitFor();
  if ((await prose().getByText("mine").count()) > 0) throw new Error("own edit kept");
});

await step("one's own save isn't someone else's", async () => {
  await prose().getByText("Third words").click();
  await editor.keyboard.press("End");
  await editor.keyboard.type(" again");
  await editor.getByRole("button", { name: "Save song" }).first().click();
  await editor.getByText("Saved.").first().waitFor().catch(() => undefined);
  await editor.waitForTimeout(1500);
  if (await editor.getByTestId("saved-elsewhere").isVisible()) throw new Error("told about its own save");
});

page = practice;
await step("a note's thread says who's replying", async () => {
  const note = await api(owner, "POST", "/notes", { songVersionId: song.id, content: "Who takes the solo?", place: "TEAM", teamId: team.id });
  const ownerPractice = await open(owner, "practice");
  await practice.reload();
  for (const p of [practice, ownerPractice]) {
    await p.locator(`[data-note-id="${note.id}"]`).first().click();
    await p.getByTestId("note-thread").waitFor();
  }
  await practice.getByTestId("note-reply-input").fill("I'll take it");
  const chip = ownerPractice.getByTestId("note-thread").getByTestId("presence-replying");
  await chip.waitFor({ timeout: 5000 });
  if (!(await chip.textContent()).includes("Milo Live is replying…")) throw new Error(await chip.textContent());
  await practice.getByTestId("note-reply-input").fill("");
  await chip.waitFor({ state: "detached", timeout: 5000 });
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});
await browser.close();
finish();
