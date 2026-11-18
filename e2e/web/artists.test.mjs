// Artists in the browser (issue #86): their pictures in the list of
// artists; an artist's page with the bio from Wikipedia and the picture
// from Deezer (stand-ins, lib/fake-providers.mjs), looked up on the first
// visit when it wasn't yet; an admin writes the bio, uploads a picture
// (cropped round) and removes it; an admin gives them another name and
// shows it (issue #512); the admin's settings.
import { chromium } from "playwright";
import { WEB, api, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { png, startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
let page;
const step = stepper(() => page);
const me = await user("Curator");
sql(`update "User" set "isGlobalAdmin"=true where id='${me.id}'`);
await api(me, "DELETE", "/admin/artists");
const band = `Choir ${stamp}`;
await api(me, "POST", "/song-versions", { title: `Choir song ${stamp}`, language: "en", artists: [band] });
for (let i = 0; i < 80 && !(await api(me, "GET", `/artists/detail?${new URLSearchParams({ name: band })}`)).lookedUp; i++) await new Promise((r) => setTimeout(r, 250));
// Another, not looked up yet: turned off while their song is added.
const quiet = `Quiet ${stamp}`;
await api(me, "PUT", "/admin/artists", { enabled: false });
await api(me, "POST", "/song-versions", { title: `Quiet song ${stamp}`, language: "en", artists: [quiet] });
await api(me, "DELETE", "/admin/artists");

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await signIn(page, me);
const artistPath = (name) => `${WEB}/library/artists/${encodeURIComponent(name)}`;

await step("their picture in the list of artists; one opens their page", async () => {
  await page.goto(`${WEB}/library/artists?q=${encodeURIComponent(band)}`);
  const card = page.getByTestId("artist-list").getByRole("link", { name: new RegExp(band) });
  await card.getByTestId("artist-image").waitFor();
  await card.click();
  await page.waitForURL(artistPath(band));
  await page.getByRole("heading", { name: band }).waitFor();
});

await step("the bio from Wikipedia, the picture from Deezer, their songs", async () => {
  const header = page.getByTestId("artist-header");
  await header.getByText(`${band} is a band.`).waitFor();
  await header.getByRole("link", { name: /From Wikipedia/ }).waitFor();
  await header.getByRole("link", { name: /Picture: Deezer/ }).waitFor();
  await header.getByTestId("artist-image").waitFor();
  await page.getByTestId("artist-songs").getByText(`Choir song ${stamp}`).waitFor();
});

await step("an admin writes the bio", async () => {
  await page.getByRole("button", { name: "Edit the bio" }).click();
  await page.getByLabel("Bio (English)").fill("A choir from here.");
  await page.getByRole("button", { name: "Save the bio" }).click();
  const bio = page.getByTestId("artist-bio");
  await bio.getByText("A choir from here.").waitFor();
  await bio.getByText("Written here").waitFor();
});

await step("an admin uploads a picture, cropped round, and removes it", async () => {
  const before = await page.getByTestId("artist-header").getByTestId("artist-image").getAttribute("src");
  await page.getByTestId("artist-upload").setInputFiles({ name: "choir.png", mimeType: "image/png", buffer: png(120, 30, 160) });
  const cropper = page.getByRole("dialog").filter({ hasText: "Crop the picture" });
  await cropper.locator("[data-testid=artist-cropper] img").waitFor();
  await cropper.getByRole("button", { name: "Use this picture" }).click();
  await cropper.waitFor({ state: "detached" });
  await page.waitForFunction((was) => document.querySelector('[data-testid="artist-header"] [data-testid="artist-image"]')?.getAttribute("src") !== was, before);
  if (await page.getByRole("link", { name: /Picture: Deezer/ }).count()) throw new Error("still credited to Deezer");
  await page.getByRole("button", { name: "Remove the picture" }).click();
  await page.getByTestId("artist-header").getByTestId("artist-initials").waitFor();
});

await step("an artist not looked up yet is, on the first visit", async () => {
  await page.goto(artistPath(quiet));
  await page.getByRole("heading", { name: quiet }).waitFor();
  await page.getByTestId("artist-header").getByText(`${quiet} is a band.`).waitFor({ timeout: 30000 });
});

await step("an admin gives them another name, shown instead: the page follows, the old name leads there", async () => {
  const renamed = `Quiet Again ${stamp}`;
  await page.getByRole("button", { name: "Edit the names" }).click();
  const editor = page.getByTestId("artist-names-editor");
  await editor.getByLabel("Another name").fill(renamed);
  await editor.getByRole("button", { name: "Add" }).click();
  await editor.getByLabel(`Show ${renamed} as the name`).check();
  await editor.getByRole("button", { name: "Save the names" }).click();
  await page.waitForURL(artistPath(renamed));
  await page.getByRole("heading", { name: renamed }).waitFor();
  await page.getByTestId("artist-other-names").getByText(`Also known as ${quiet}`).waitFor();
  await page.goto(artistPath(quiet));
  await page.getByRole("heading", { name: renamed }).waitFor();
});

await step("the admin's artist settings", async () => {
  await page.goto(`${WEB}/admin/metadata`);
  const card = page.getByTestId("artist-settings");
  await card.getByText("Currently using: the defaults (on).").waitFor();
  await card.getByLabel("Look up artists' pictures and bios").uncheck();
  await card.getByRole("button", { name: "Save configuration" }).click();
  await card.getByText("Currently using: settings saved here.").waitFor();
  await card.getByRole("button", { name: "Revert to environment variables" }).click();
  await card.getByRole("button", { name: "Revert", exact: true }).click();
  await card.getByText("Currently using: the defaults (on).").waitFor();
});

await browser.close();
fake.close();
finish();
