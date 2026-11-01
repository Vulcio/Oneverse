// Browser test: avatar crop dialog, sized avatar URLs, attachment thumbnails.
import { chromium } from "playwright";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { API, LOG, ONEVERSE, SP, WEB, finish, sql, stamp, stepper } from "../lib/harness.mjs";


let page;
const step = stepper(() => page);

const email = `ui-crop-${stamp}@example.com`;
const offset = readFileSync(LOG, "utf8").length;
await fetch(`${API}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: WEB },
  body: JSON.stringify({ email, password: "hunter2pass", name: "Crop Tester" }),
});
let link;
for (let i = 0; i < 30 && !link; i++) {
  await new Promise((r) => setTimeout(r, 300));
  link = readFileSync(LOG, "utf8").slice(offset).match(/https?:\/\/[^\s]+?\/api\/auth\/verify-email\?token=[^\s&]+/)?.[0];
}
await fetch(link, { redirect: "manual" });
// A returning user's: "What do you play or do?" (issue #109) would cover the account page.
sql(`update "User" set "profilePromptSkippedAt" = now() where email = '${email}'`);
const signIn = await fetch(`${API}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: WEB },
  body: JSON.stringify({ email, password: "hunter2pass" }),
});
const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const bearer = (await (await fetch(`${API}/api/auth/token`, { headers: { cookie, Origin: WEB } })).json()).token;

// Fixtures: a wide photo (left half red, right half blue) and a file that isn't an image.
const wide = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#dd2222" } })
  .composite([{ input: await sharp({ create: { width: 800, height: 900, channels: 3, background: "#2244dd" } }).png().toBuffer(), left: 800, top: 0 }])
  .jpeg()
  .toBuffer();
writeFileSync(`${SP}/wide.jpg`, wide);
writeFileSync(`${SP}/broken.png`, "definitely not a picture");

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

await step("sign in and open account settings", async () => {
  await page.goto(WEB);
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.fill("#signin-email", email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/library");
  await page.goto(`${WEB}/account`);
  await page.waitForLoadState("networkidle");
});

await step("cancelling the crop leaves the avatar unchanged", async () => {
  await page.getByTestId("avatar-input").setInputFiles(`${SP}/wide.jpg`);
  await page.getByRole("dialog", { name: "Crop your picture" }).waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  if ((await page.getByRole("button", { name: "Remove picture" }).count()) !== 0) throw new Error("avatar was set");
});

await step("an unreadable file shows an error in the dialog", async () => {
  await page.getByTestId("avatar-input").setInputFiles(`${SP}/broken.png`);
  await page.getByText("This image couldn't be opened").waitFor();
  if (await page.getByRole("button", { name: "Save picture" }).isEnabled()) throw new Error("save enabled");
  await page.getByRole("button", { name: "Cancel" }).click();
});

await step("crop dialog: zoom and save", async () => {
  await page.getByTestId("avatar-input").setInputFiles(`${SP}/wide.jpg`);
  const dialog = page.getByRole("dialog", { name: "Crop your picture" });
  await dialog.waitFor();
  await dialog.locator("[data-testid=avatar-cropper] img").waitFor();
  await page.getByLabel("Zoom").fill("1.5");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SP}/crop-dialog.png` });
  await page.getByRole("button", { name: "Save picture" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Remove picture" }).waitFor();
});

await step("stored avatar is a square WebP of at most 512px", async () => {
  const me = await (await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${bearer}` } })).json();
  const body = Buffer.from(await (await fetch(me.avatarUrl)).arrayBuffer());
  const meta = await sharp(body).metadata();
  // At zoom 1.5 the crop is a 600x600 region of the 900px-tall photo, exported at 512.
  if (meta.format !== "webp" || meta.width !== meta.height || meta.width > 512) throw new Error(`${meta.format} ${meta.width}x${meta.height}`);
  console.log(`     stored: ${meta.format} ${meta.width}x${meta.height}`);
});

await step("page and sidebar request right-sized avatars", async () => {
  await page.waitForFunction(() => {
    const srcs = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
    return srcs.some((s) => s.endsWith("?size=128")) && srcs.some((s) => s.endsWith("?size=64"));
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("img")].filter((img) => img.src.includes("/avatar/")).every((img) => img.complete && img.naturalWidth > 0),
  );
  const sizes = await page.$$eval("img", (imgs) => imgs.filter((i) => i.src.includes("/avatar/")).map((i) => `${i.getAttribute("src").split("?")[1]}→${i.naturalWidth}px`));
  console.log(`     ${sizes.join(", ")}`);
  await page.screenshot({ path: `${SP}/crop-account.png` });
});

await step("image attachments show a thumbnail under the song's Files", async () => {
  const song = await (await fetch(`${API}/song-versions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: `Thumb Song ${stamp}`, language: "en", artists: ["Test Artist"] }),
  })).json();
  const form = new FormData();
  form.append("type", "IMAGE");
  form.append("file", new Blob([wide], { type: "image/jpeg" }), "score-scan.jpg");
  await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: form });
  await page.goto(`${WEB}/library/${song.id}?tab=files`);
  const thumb = page.getByRole("img", { name: "score-scan.jpg" });
  await thumb.waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector('img[alt="score-scan.jpg"]');
    return img && img.complete && img.naturalWidth > 0;
  });
  const natural = await thumb.evaluate((img) => `${img.naturalWidth}x${img.naturalHeight}`);
  if (natural !== "96x54") throw new Error(`unexpected thumbnail size ${natural}`);
  await thumb.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SP}/crop-thumbnail.png` });
});

await browser.close();
finish();
