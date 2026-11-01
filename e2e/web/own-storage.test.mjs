// An organisation's own bucket in the browser (issue #206): its admin, with a
// role that allows it, connects one from the organisation's page (tried when
// saved), sees how many files are there, sets the defaults for what goes in,
// makes a role of its own that keeps files there, and stops using it with a
// confirm step; without the server admin's go-ahead the card only says who to ask.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

if (!process.env.OWN_STORAGE_LOCAL_DIR) {
  console.log("SKIP web/own-storage: OWN_STORAGE_LOCAL_DIR isn't set");
  process.exit(0);
}

let page;
const step = stepper(() => page);
const admin = await user("Own storage web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const me = await user("Own storage web");
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const org = await api(me, "POST", "/organizations", { name: `Own storage web ${stamp}` });

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);

  await step("not allowed yet: the card says who to ask", async () => {
    await page.goto(`${WEB}/organizations/${org.id}`);
    await page.getByTestId("own-storage-card").getByText("ask them").waitFor();
    if (await page.getByTestId("own-storage-save").count()) throw new Error("form shown");
  });

  await call(admin, "PUT", "/admin/organizations/settings", { ownStorage: true });
  const role = await api(admin, "POST", "/admin/roles", { name: `Own storage web ${stamp}`, canUseOwnStorage: true });
  await api(admin, "PUT", `/admin/users/${me.id}/roles`, { roleIds: [role.id, "role_audio_uploads"] });

  await step("allowed: a bucket connected, tried when saved", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId("own-storage-card");
    await card.getByTestId("own-storage-provider").selectOption("B2");
    await card.getByTestId("own-storage-region").fill("us-west-004");
    await card.getByTestId("own-storage-bucket").fill(`web-bucket-${stamp}`);
    await card.getByTestId("own-storage-key").fill(`key${stamp}`);
    await card.getByTestId("own-storage-secret").fill(`secret${stamp}`);
    await card.getByTestId("own-storage-save").click();
    await card.getByTestId("own-storage-saved").waitFor();
    await card.locator('[data-testid="own-storage-status"][data-state="ACTIVE"]').waitFor();
    await card.getByTestId("own-storage-files").getByText("0 files there").waitFor();
    if ((await card.getByTestId("own-storage-secret").inputValue()) !== "") throw new Error("secret left in the form");
  });

  await step("limits set: per team and the largest file, the rest left without", async () => {
    const card = page.getByTestId("own-storage-card");
    await card.getByTestId("own-storage-teamLimitMb").fill("200");
    await card.getByTestId("own-storage-maxFileMb").fill("20");
    await card.getByTestId("own-storage-limits-save").click();
    await card.getByTestId("own-storage-limits-saved").waitFor();
    const now = await api(me, "GET", `/organizations/${org.id}/storage`);
    if (now.teamLimitMb !== 200 || now.maxFileMb !== 20 || now.memberLimitMb !== null) throw new Error(JSON.stringify(now));
  });

  await step("its own role, made on its page with the same editor as Admin > Roles: keeps files there, with a tier", async () => {
    const card = page.getByTestId("scoped-roles-card");
    await card.getByTestId("own-role-new").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("role-name").fill(`Keeper ${stamp}`);
    if (await dialog.getByTestId("role-review").count()) throw new Error("review offered to an organisation");
    await dialog.getByTestId("role-store-files").check();
    await dialog.getByTestId("role-storage-mb").fill("50");
    await dialog.getByTestId("role-save").click();
    await dialog.waitFor({ state: "detached" });
    const roles = await api(me, "GET", `/organizations/${org.id}/roles`);
    const role = roles.own.find((one) => one.name === `Keeper ${stamp}`);
    if (!role?.canStoreFiles || role.storageLimitMb !== 50) throw new Error(JSON.stringify(roles.own));
    await card.getByTestId(`own-role-${role.id}`).getByText("Keeps files in its storage (50 MB)").waitFor();
    await card.getByTestId(`scoped-role-${role.id}-${me.id}`).check();
    for (let i = 0; i < 20; i++) {
      if ((await api(me, "GET", `/organizations/${org.id}/roles`)).members.find((one) => one.userId === me.id)?.roleIds.includes(role.id)) return;
      await page.waitForTimeout(250);
    }
    throw new Error("not given");
  });

  await step("stopped, with a confirm step: disconnected", async () => {
    const card = page.getByTestId("own-storage-card");
    await card.getByRole("button", { name: "Stop using it" }).click();
    await card.getByRole("button", { name: "Move the files back and disconnect" }).click();
    await card.getByTestId("own-storage-status").waitFor({ state: "detached" });
    const now = await api(me, "GET", `/organizations/${org.id}/storage`);
    if (now.configured) throw new Error(JSON.stringify(now));
  });
} finally {
  await browser.close();
  await call(admin, "DELETE", "/admin/organizations/settings");
}
finish();
