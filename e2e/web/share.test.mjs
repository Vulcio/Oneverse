// Browser test for set sharing (issue #7).
import { chromium } from "playwright";
import { ONEVERSE, SP, WEB, api, finish, sidebarEntry, signIn, sql, stamp, stepper, tag, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// Fixtures
const owner = await user("Olivia Owner");
const guest = await user("Gabe Guest");
const admin2 = await user("Ada Admin");
const member = await user("Milo Member");
const team = await api(owner, "POST", "/teams", { name: `Worship ${tag}` });
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tsa${stamp}', '${team.id}', '${admin2.id}', 'ADMIN', now(), now()), ('tsm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const mine = await api(owner, "POST", "/song-versions", { artists: ["Test Artist"], title: `Olivia's Song ${tag}`, language: "en" });
await api(owner, "PATCH", `/song-versions/${mine.id}`, { contentFormat: "CHORDPRO", content: "{start_of_verse}\n[G]Morning has [C]broken\n{end_of_verse}\n" });
await api(owner, "PATCH", `/song-versions/${mine.id}`, { key: "G" });
const mine2 = await api(owner, "POST", "/song-versions", { artists: ["Test Artist"], title: `Second Song ${tag}`, language: "en" });
const set = await api(owner, "POST", "/setlists", { name: `Sunday ${tag}` });
await api(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: mine.id, transposeSteps: 2 });
await api(owner, "POST", `/setlists/${set.id}/items`, { songVersionId: mine2.id });

const browser = await chromium.launch();
const errors = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(`${e.message} @ ${p.url()}`));
  return p;
}
const ownerPage = await newPage();
const guestPage = await newPage();
page = ownerPage;
await signIn(ownerPage, owner);

let inviteUrl;
await step("owner creates a share link", async () => {
  await ownerPage.goto(`${WEB}/sets/${set.id}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.getByText("Sharing is off.").waitFor();
  await ownerPage.getByRole("button", { name: "Create a share link" }).click();
  const input = ownerPage.getByRole("textbox", { name: "Share" });
  await input.waitFor();
  inviteUrl = await input.inputValue();
  if (!inviteUrl.startsWith(`${WEB}/set-invite/`)) throw new Error(inviteUrl);
});

page = guestPage;
await step("signed-out guest sees what's shared and a way to sign in", async () => {
  await guestPage.goto(inviteUrl);
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByText(`Sunday ${tag}`).waitFor();
  await guestPage.getByText("Olivia Owner is sharing a set with you. 2 songs").waitFor();
  await guestPage.getByTestId("set-invite-sign-in").waitFor();
});

await step("guest signs in, opens the set and lands on it as a guest", async () => {
  // At Oneverse (issue #303), and back.
  await guestPage.getByTestId("set-invite-sign-in").click();
  await guestPage.waitForURL(`${ONEVERSE}/sign-in**`);
  await guestPage.waitForLoadState("networkidle");
  await guestPage.fill("#signin-email", guest.email);
  await guestPage.fill("#signin-password", "hunter2pass");
  await guestPage.getByRole("button", { name: /Sign in/ }).first().click();
  await guestPage.waitForURL(inviteUrl);
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByRole("button", { name: "Open set" }).click();
  await guestPage.waitForURL(`**/sets/${set.id}`);
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByText("Guest", { exact: true }).first().waitFor();
  await guestPage.getByText(/Olivia Owner shared this set with you/).waitFor();
  if ((await guestPage.getByRole("button", { name: "Save" }).count()) > 0) throw new Error("guest sees the details form");
  if ((await guestPage.getByText("Add songs").count()) > 0) throw new Error("guest can add songs");
});

await step("the set shows up in the guest's sidebar", async () => {
  await (await sidebarEntry(guestPage, "Sets", `Sunday ${tag}`)).waitFor();
});

await step("guest reads a song that isn't in their library, through the set", async () => {
  await guestPage.getByTestId("set-song-list").getByRole("link", { name: `Olivia's Song ${tag}` }).click();
  await guestPage.waitForURL(/\/songs\//);
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByRole("heading", { name: `Olivia's Song ${tag}` }).waitFor();
  await guestPage.getByText("Song 1 of 2 · A (+2)").waitFor();
  await guestPage.getByText("Morning has").waitFor();
  if ((await guestPage.getByRole("link", { name: "Open in library" }).count()) > 0) throw new Error("offered to open in library");
});

await step("guest keeps a note just for them in this set, that survives a reload", async () => {
  await guestPage.getByTestId("notes-button").click();
  await guestPage.getByTestId("notes-add").click();
  await guestPage.getByTestId("add-note-input").fill("Capo 2, start soft");
  await guestPage.getByTestId("add-note-places").locator('[data-place="ME:set"]').click();
  await guestPage.getByTestId("add-note-save").click();
  await guestPage.getByTestId("song-notes-top").getByText("Capo 2, start soft").waitFor();
  await guestPage.reload();
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByTestId("song-notes-top").getByText("Capo 2, start soft").waitFor();
});

await step("guest steps to the next song", async () => {
  await guestPage.getByRole("link", { name: "Next" }).click();
  await guestPage.getByRole("heading", { name: `Second Song ${tag}` }).waitFor();
  await guestPage.getByText("Song 2 of 2").waitFor();
  await guestPage.waitForLoadState("networkidle");
  if ((await guestPage.getByText("Capo 2, start soft").count()) > 0) throw new Error("note carried over");
  await guestPage.getByRole("link", { name: "Previous" }).waitFor();
});

page = ownerPage;
await step("owner sees the guest, but not their note", async () => {
  await ownerPage.reload();
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.getByTestId("set-guests").getByText("Gabe Guest").waitFor();
  await ownerPage.goto(`${WEB}/sets/${set.id}/songs/${(await api(owner, "GET", `/setlists/${set.id}`)).items[0].id}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.getByRole("link", { name: "Open in library" }).waitFor();
  if ((await ownerPage.getByText("Capo 2, start soft").count()) > 0) throw new Error("owner sees guest's note");
});

await step("owner moves the set to their team; their songs show as shared", async () => {
  await ownerPage.goto(`${WEB}/sets/${set.id}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.selectOption("#set-owner", team.id);
  const dialog = ownerPage.getByRole("dialog");
  await dialog.getByText(`It will belong to Worship ${tag}`).waitFor();
  await dialog.getByText(/Your personal songs in it stay/).waitFor();
  await dialog.getByRole("button", { name: "Move set" }).click();
  await dialog.waitFor({ state: "detached" });
  await ownerPage.getByText(`Sunday ${tag}`).first().waitFor();
  const rows = ownerPage.getByTestId("set-song-row");
  if ((await rows.getByText("Shared by you").count()) !== 2) throw new Error("expected 2 shared badges");
  await rows.getByRole("button", { name: "Give to team" }).first().waitFor();
});

const adminPage = await newPage();
page = adminPage;
await signIn(adminPage, admin2);
await step("another team admin asks for a shared song", async () => {
  await adminPage.goto(`${WEB}/sets/${set.id}`);
  await adminPage.waitForLoadState("networkidle");
  const row = adminPage.getByTestId("set-song-row").filter({ hasText: `Olivia's Song ${tag}` });
  await row.getByText("Shared by Olivia Owner").waitFor();
  await row.getByRole("button", { name: "Ask for this song" }).click();
  await row.getByText("Requested").waitFor();
});

page = ownerPage;
await step("owner hands the song over from the dashboard", async () => {
  await ownerPage.goto(`${WEB}/dashboard`);
  await ownerPage.waitForLoadState("networkidle");
  const card = ownerPage.getByTestId("ownership-requests");
  await card.getByText(`Worship ${tag} would like Olivia's Song ${tag}`).waitFor();
  await card.getByText("Asked by Ada Admin").waitFor();
  await card.getByRole("button", { name: "Hand over" }).click();
  await card.waitFor({ state: "detached" });
  if (sql(`select "ownerScope" from "SongVersion" where id='${mine.id}'`) !== "TEAM") throw new Error("song not moved");
});

const memberPage = await newPage();
page = memberPage;
await signIn(memberPage, member);
await step("team members see the handed-over song as the team's, and the other still shared", async () => {
  await memberPage.goto(`${WEB}/sets/${set.id}`);
  await memberPage.waitForLoadState("networkidle");
  const rows = memberPage.getByTestId("set-song-row");
  if ((await rows.filter({ hasText: `Olivia's Song ${tag}` }).getByText(/Shared by/).count()) !== 0) throw new Error("still shared");
  await rows.filter({ hasText: `Second Song ${tag}` }).getByText("Shared by Olivia Owner").waitFor();
  await memberPage.getByText(/only the team's admins can change it/).waitFor();
});

page = guestPage;
await step("guest leaves the set", async () => {
  await guestPage.goto(`${WEB}/sets/${set.id}`);
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByText(/Worship .* team shared this set with you/).waitFor();
  await guestPage.getByRole("button", { name: "Leave set" }).click();
  await guestPage.getByRole("dialog").getByRole("button", { name: "Leave set" }).click();
  await guestPage.waitForURL("**/sets");
  // The old page stays up until the Sets page has loaded.
  await guestPage.getByRole("heading", { name: "Sets", exact: true }).waitFor();
  await guestPage.waitForLoadState("networkidle");
  await guestPage.getByText(`Sunday ${tag}`).first().waitFor({ state: "detached", timeout: 5000 });
});

page = ownerPage;
await step("set and song pages fit a phone screen", async () => {
  await ownerPage.setViewportSize({ width: 360, height: 780 });
  const itemId = (await api(owner, "GET", `/setlists/${set.id}`)).items[0].id;
  for (const path of [`/sets/${set.id}`, `/sets/${set.id}/songs/${itemId}`, "/sets", "/dashboard"]) {
    await ownerPage.goto(`${WEB}${path}`);
    await ownerPage.waitForLoadState("networkidle");
    const over = await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) throw new Error(`${path} overflows by ${over}px`);
  }
  await ownerPage.goto(`${WEB}/sets/${set.id}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.screenshot({ path: `${SP}/share-set-mobile.png`, fullPage: true });
  await ownerPage.goto(`${WEB}/sets/${set.id}/songs/${itemId}`);
  await ownerPage.waitForLoadState("networkidle");
  await ownerPage.screenshot({ path: `${SP}/share-song-mobile.png`, fullPage: true });
});

await step("no page errors", async () => {
  const relevant = errors.filter((e) => !(e.includes("Hydration failed") && e.includes("Abkhazian")));
  if (relevant.length) throw new Error(relevant.slice(0, 2).join(" | "));
});

await browser.close();
finish();
