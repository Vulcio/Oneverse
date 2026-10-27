// People and sharing in the browser (issue #77): asking someone by email,
// their accepting, sharing a song with them to edit; what they see and
// can do; a file for the people it's shared with (#79); taking it out of
// their library.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, stamp, stepper, user, showStatusColumn } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const alice = await user("Alice");
const bob = await user("Bob");
const title = `Shared song ${stamp}`;
const song = await api(alice, "POST", "/song-versions", { title, language: "en", artists: ["Alice"], content: "{start_of_verse}\n[G]Line\n{end_of_verse}\n" });

const browser = await chromium.launch();
const pageFor = async (who) => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signIn(p, who);
  return p;
};
const alicePage = await pageFor(alice);
const bobPage = await pageFor(bob);

await step("Alice asks Bob, by email, from People in the sidebar", async () => {
  page = alicePage;
  await page.goto(`${WEB}/library`);
  await page.getByRole("link", { name: "People", exact: true }).click();
  await page.waitForURL(`${WEB}/people`);
  await page.getByLabel("Their email address").fill(bob.email);
  await page.getByRole("button", { name: "Ask" }).click();
  await page.getByText("Asked. We've emailed them; they'll see your request when they sign in.").waitFor();
  await page.getByTestId("people-outgoing").getByText(bob.email.toLowerCase()).waitFor();
});

await step("Bob accepts", async () => {
  page = bobPage;
  await page.goto(`${WEB}/people`);
  const incoming = page.getByTestId("people-incoming");
  await incoming.getByText("Alice", { exact: true }).waitFor();
  await incoming.getByRole("button", { name: "Accept" }).click();
  await page.getByTestId("people-list").getByText("Alice", { exact: true }).waitFor();
});

await step("Alice shares her song with Bob, to edit", async () => {
  page = alicePage;
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("It isn't shared with anyone yet.").waitFor();
  await dialog.getByLabel("Share with").selectOption({ label: "Bob" });
  await dialog.getByLabel("Can view or edit").selectOption("edit");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  const shares = dialog.getByTestId("song-shares");
  await shares.getByText("Bob", { exact: true }).waitFor();
  if ((await shares.getByLabel("What Bob can do").inputValue()) !== "edit") throw new Error("not to edit");
  await page.keyboard.press("Escape");
});

await step("Bob finds it in his library, shared by Alice, and edits it", async () => {
  page = bobPage;
  await showStatusColumn(page);
  await page.goto(`${WEB}/library?q=${encodeURIComponent(title)}`);
  await page.getByRole("row").filter({ hasText: title }).getByText("Shared by Alice").waitFor();
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByText("Shared by Alice · you can edit it").waitFor();
  if (await page.getByRole("button", { name: "Share", exact: true }).count()) throw new Error("Bob can share it");
  await page.getByLabel("Song name").fill(`${title} (Bob)`);
  await page.getByRole("button", { name: "Save song" }).click();
  await page.getByText("Saved.").waitFor();
  if ((await api(alice, "GET", `/song-versions/${song.id}`)).title !== `${title} (Bob)`) throw new Error("not saved");
  await page.getByRole("button", { name: "More actions" }).click();
  if (await page.getByRole("menuitem", { name: "Delete song" }).count()) throw new Error("Bob can delete it");
  await page.keyboard.press("Escape");
});

await step("Alice shows a file to the people she shares it with; Bob sees it", async () => {
  page = alicePage;
  await page.goto(`${WEB}/library/${song.id}?tab=files`);
  await page.waitForLoadState("networkidle"); // hydrated: the choice sticks
  await page.getByLabel("Who sees the files you add").selectOption({ label: "The people I share it with" });
  await page.getByTestId("files-input").setInputFiles({ name: "for-bob.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4 ${title}`) });
  const who = page.getByTestId("files-list").getByLabel("Who sees for-bob.pdf");
  await who.waitFor();
  if ((await who.inputValue()) !== "SHARED") throw new Error(await who.inputValue());
  page = bobPage;
  await page.goto(`${WEB}/library/${song.id}?tab=files`);
  await page.getByTestId("files-list").getByText("Shared by Alice with the people this song is shared with").waitFor();
});

await step("Bob takes it out of his library", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Remove from my library" }).click();
  await page.waitForURL(`${WEB}/library`);
  const shares = await api(alice, "GET", `/song-versions/${song.id}/shares`);
  if (shares.length !== 0) throw new Error(JSON.stringify(shares));
});

await browser.close();
finish();
