// Manage devices (issue #322): someone whose role on a team manages its
// screens pairs one for the team from Screens - the team is offered under
// "For" - and its settings don't offer to give it to someone else.
import { chromium } from "playwright";
import { API, WEB, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Managers web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const lead = await user("Managers web lead");
const tech = await user("Managers web tech");
const role = (await call(admin, "POST", "/admin/roles", { name: `Screens manager web ${stamp}`, canManageScreens: true, teamAssignable: true })).body;
const team = (await call(lead, "POST", "/teams", { name: `Managers web band ${stamp}` })).body;
await call(tech, "POST", `/teams/join/${(await call(lead, "POST", `/teams/${team.id}/invite-links`, {})).body.token}`);
await call(lead, "PUT", `/teams/${team.id}/members/${tech.id}/roles`, { roleIds: [role.id] });
const pairing = await fetch(`${API}/screens/pairings`, { method: "POST" }).then((res) => res.json());

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await signIn(page, tech);

  await step("the team is offered under For, and the screen is paired for it", async () => {
    await page.goto(`${WEB}/screens?code=${pairing.code}`);
    await page.getByTestId("screen-owner").selectOption({ label: `Team: Managers web band ${stamp}` });
    await page.locator("#screen-name").fill("Booth");
    await page.getByTestId("screen-pair-form").getByRole("button", { name: "Pair screen" }).click();
    const alert = page.getByTestId("screen-pair-form").getByRole("alert");
    await Promise.race([
      page.getByTestId("screens-list").getByTestId("screen-Booth").waitFor(),
      alert.waitFor().then(async () => {
        throw new Error(await alert.textContent());
      }),
    ]);
    const [screen] = (await call(tech, "GET", "/screens")).body.filter((one) => one.name === "Booth");
    if (screen?.owner.id !== team.id || !screen.canManage) throw new Error(JSON.stringify(screen));
  });

  await step("its settings don't offer to give it away", async () => {
    const [screen] = (await call(tech, "GET", "/screens")).body.filter((one) => one.name === "Booth");
    await page.getByTestId("screens-list").getByTestId("screen-Booth").getByTestId("screen-settings").click();
    await page.getByTestId("screen-dialog").waitFor();
    if (await page.locator(`#screen-owner-${screen.id}`).count()) throw new Error("Belongs to is offered to someone who manages it by a role");
  });
} finally {
  await browser.close();
}
finish();
