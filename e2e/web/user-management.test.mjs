// Browser end-to-end test for user management (admin table/dialogs, transfer claim, storage limits, account profile).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { API, LOG, ONEVERSE, SP, WEB, finish, sql, stamp, stepper, tag, user } from "../lib/harness.mjs";


async function signUpVerified(tag, name) {
  const email = `ui-${tag}-${stamp}@example.com`;
  const offset = readFileSync(LOG, "utf8").length;
  await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WEB },
    body: JSON.stringify({ email, password: "hunter2pass", name }),
  });
  let link;
  for (let i = 0; i < 30 && !link; i++) {
    await new Promise((r) => setTimeout(r, 300));
    link = readFileSync(LOG, "utf8").slice(offset).match(/https?:\/\/[^\s]+?\/api\/auth\/verify-email\?token=[^\s&]+/)?.[0];
  }
  await fetch(link, { redirect: "manual" });
  const id = sql(`select id from "User" where email='${email}'`);
  // A returning user's: "What do you play or do?" (issue #109) would cover the pages tested.
  sql(`update "User" set "profilePromptSkippedAt" = now() where id = '${id}'`);
  return { email, name, id };
}

async function bearerFor(email) {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WEB },
    body: JSON.stringify({ email, password: "hunter2pass" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return (await (await fetch(`${API}/api/auth/token`, { headers: { cookie, Origin: WEB } })).json()).token;
}

async function createSong(email, title) {
  const bearer = await bearerFor(email);
  await fetch(`${API}/song-versions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, language: "en", artists: ["Test Artist"] }),
  });
}

async function signInUi(page, email) {
  // At Oneverse (issue #303).
  await page.goto(WEB);
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.fill("#signin-email", email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const browser = await chromium.launch();
let current;
const step = stepper(() => current);

const admin = await signUpVerified("admin", `UI Admin ${stamp % 100000}`);
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await signUpVerified("owner", `UI Owner ${stamp % 100000}`);
const victim = await signUpVerified("victim", `UI Victim ${stamp % 100000}`);
const claimant = await signUpVerified("claimant", `UI Claimant ${stamp % 100000}`);
const songTitle = `UI Transfer Song ${stamp}`;
await createSong(owner.email, songTitle);

// A storage tier (issue #160): a role with a limit, given in the user's Roles dialog.
const tierName = `Storage 5 MB ${stamp}`;
sql(`insert into "Role" (id, name, "storageLimitMb", "updatedAt") values ('role_ui_${stamp}', '${tierName}', 5, now())`);

const adminPage = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
current = adminPage;
const rowFor = (user) => adminPage.getByRole("row").filter({ hasText: user.email });
const openActions = async (user, item) => {
  await adminPage.getByRole("button", { name: `Actions for ${user.name}` }).click();
  await adminPage.getByRole("menuitem", { name: item }).click();
};

await step("admin sees the users table with status and storage", async () => {
  await signInUi(adminPage, admin.email);
  await adminPage.waitForURL("**/library");
  await adminPage.goto(`${WEB}/admin/users`);
  await adminPage.waitForLoadState("networkidle");
  await rowFor(owner).getByText("Verified").filter({ visible: true }).waitFor();
  await rowFor(owner).getByText("0 B / 50.0 MB").waitFor();
  await rowFor(admin).getByText("Unlimited").waitFor();
  // The viewport only: a test database's users table can be thousands of rows long.
  await adminPage.screenshot({ path: `${SP}/ui-admin-users.png` });
});

await step("search filters by email", async () => {
  await adminPage.getByPlaceholder("Search by name or email…").fill(owner.email);
  await adminPage.waitForFunction((n) => document.querySelectorAll("tbody tr").length === n, 1);
  await adminPage.getByPlaceholder("Search by name or email…").fill("");
});

await step("admin gives a user a storage tier", async () => {
  await openActions(owner, "Roles…");
  await adminPage.getByTestId("roles-dialog-list").getByLabel(new RegExp(tierName)).check();
  await adminPage.getByTestId("roles-dialog-save").click();
  await rowFor(owner).getByText("0 B / 5.0 MB").waitFor();
  await rowFor(owner).getByTestId("user-roles").getByText(tierName).waitFor();
});

await step("admin bans a user with a reason", async () => {
  await openActions(owner, "Ban");
  await adminPage.getByLabel(/Reason/).fill("Testing bans");
  await adminPage.getByRole("button", { name: "Ban user" }).click();
  await rowFor(owner).getByText("Banned").filter({ visible: true }).waitFor();
});

await step("banned user sees the reason when signing in", async () => {
  const page = await (await browser.newContext()).newPage();
  current = page;
  await signInUi(page, owner.email);
  await page.getByText("Your account has been suspended: Testing bans").waitFor();
  current = adminPage;
});

await step("admin unbans the user", async () => {
  await openActions(owner, "Unban");
  await rowFor(owner).getByText("Banned").filter({ visible: true }).waitFor({ state: "detached" });
});

let transferUrl;
await step("admin deletes a user keeping content behind a transfer link", async () => {
  await openActions(owner, "Delete user");
  const confirm = adminPage.getByRole("button", { name: "Delete user" });
  if (await confirm.isEnabled()) throw new Error("delete enabled before typing the email");
  await adminPage.getByLabel(`Type ${owner.email} to confirm`).fill(owner.email);
  await confirm.click();
  const linkInput = adminPage.getByRole("textbox", { name: "Transfer link" });
  await linkInput.waitFor();
  transferUrl = await linkInput.inputValue();
  if (!transferUrl.startsWith(`${WEB}/transfer/`)) throw new Error(`unexpected link ${transferUrl}`);
  await adminPage.screenshot({ path: `${SP}/ui-transfer-link.png` });
  await adminPage.getByRole("button", { name: "Done" }).click();
  await rowFor(owner).getByText(/Deleted · transfer until/).filter({ visible: true }).waitFor();
});

await step("signed-out visitor signs in from the link and claims the content", async () => {
  const page = await (await browser.newContext()).newPage();
  current = page;
  // Off to sign in at Oneverse (issue #303), and back.
  await page.goto(transferUrl);
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.fill("#signin-email", claimant.email);
  await page.fill("#signin-password", "hunter2pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("1 song(s)").waitFor();
  await page.waitForLoadState("networkidle");
  if (page.url() !== transferUrl) throw new Error(`landed on ${page.url()}`);
  await page.screenshot({ path: `${SP}/ui-transfer-claim.png` });
  await page.getByRole("button", { name: "Accept content" }).click();
  await page.getByText("Done - the content is now yours.").waitFor();
  await page.getByRole("link", { name: "Go to library" }).click();
  await page.getByRole("row").getByText(songTitle).waitFor(); // in the list, not the home's shelves
  current = adminPage;
});

await step("claimed account disappears from the admin table", async () => {
  await adminPage.reload();
  await adminPage.waitForLoadState("networkidle");
  if ((await rowFor(owner).count()) !== 0) throw new Error("row still present");
});

await step("admin deletes a user together with their content", async () => {
  await openActions(victim, "Delete user");
  await adminPage.getByLabel("Delete their content now").check();
  await adminPage.getByLabel(`Type ${victim.email} to confirm`).fill(victim.email);
  await adminPage.getByRole("button", { name: "Delete user" }).click();
  // Rows are aria-hidden while the dialog is open, so wait for it to close first.
  await adminPage.getByRole("dialog").waitFor({ state: "detached" });
  await rowFor(victim).waitFor({ state: "detached" });
  if (sql(`select count(*) from "User" where id='${victim.id}'`) !== "0") throw new Error("user still in db");
});

await step("admin sets and resets the default storage limit", async () => {
  await adminPage.goto(`${WEB}/admin/storage`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByLabel("Default limit per user (MB)").fill("60");
  const card = adminPage.locator('[data-slot="card"]').filter({ hasText: "Storage limits" });
  await card.getByRole("button", { name: "Save" }).click();
  await card.getByRole("button", { name: /Reset to built-in default \(50 MB\)/ }).waitFor();
  await adminPage.screenshot({ path: `${SP}/ui-admin-storage-limits.png`, fullPage: true });
  await card.getByRole("button", { name: /Reset to built-in default \(50 MB\)/ }).click();
  await card.getByText("Built-in default", { exact: true }).first().waitFor();
});

const userPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
current = userPage;
await step("user renames themselves and the sidebar updates", async () => {
  await signInUi(userPage, claimant.email);
  await userPage.waitForURL("**/library");
  await userPage.goto(`${WEB}/account`);
  await userPage.waitForLoadState("networkidle");
  await userPage.getByLabel("Display name").fill("Renamed Claimant");
  await userPage.getByRole("button", { name: "Save", exact: true }).click();
  await userPage.getByText("Saved.").waitFor();
  // The account menu, at the bottom of the sidebar's rail, is named after them (#80).
  await userPage.locator('[data-slot="sidebar-footer"]').getByRole("button", { name: "Renamed Claimant" }).waitFor();
});

await step("user uploads an avatar and it shows in the sidebar", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR42mNk+M9AEmAcVTiqcFThqMJRhaMKRxUCAPfXEAG0hlWDAAAAAElFTkSuQmCC",
    "base64",
  );
  writeFileSync(`${SP}/avatar.png`, png);
  await userPage.getByTestId("avatar-input").setInputFiles(`${SP}/avatar.png`);
  await userPage.getByRole("button", { name: "Save picture" }).click();
  await userPage.getByRole("button", { name: "Remove picture" }).waitFor();
  await userPage.waitForFunction(() =>
    [...document.querySelectorAll("img")].some((img) => img.src.includes("/avatar/") && img.complete && img.naturalWidth > 0),
  );
  await userPage.screenshot({ path: `${SP}/ui-account.png`, fullPage: true });
});

await step("user removes the avatar", async () => {
  await userPage.getByRole("button", { name: "Remove picture" }).click();
  await userPage.getByRole("button", { name: "Remove picture" }).waitFor({ state: "detached" });
});

await step("storage card shows usage against the limit", async () => {
  await userPage.getByText("of 50.0 MB used").waitFor();
});

await step("email change, at Oneverse, sends an approval to the current address", async () => {
  // Email and passkeys are Oneverse's (issue #303): signed in there already.
  await userPage.goto(`${ONEVERSE}/account`);
  await userPage.waitForLoadState("networkidle");
  const offset = readFileSync(LOG, "utf8").length;
  await userPage.getByLabel("New email").fill(`ui-claimant-new-${stamp}@example.com`);
  await userPage.getByRole("button", { name: "Change email" }).click();
  await userPage.getByText(/approve the change there/).waitFor();
  for (let i = 0; i < 20; i++) {
    if (readFileSync(LOG, "utf8").slice(offset).includes(`To: ${claimant.email}\nSubject: Approve your Songverse email change`)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("approval email not sent to current address");
});

await browser.close();
sql(`delete from "Role" where id='role_ui_${stamp}'`);
finish();
