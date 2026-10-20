// A team's own Songverse Sonic server in the web app (issue #300), against a stand-in (e2e/lib/fake-demucs.mjs): Admin >
// Stem separation, with no server of its own, lets teams and organisations connect theirs (on private addresses: the
// stand-in is on localhost); the card isn't on a team's page before; its admin connects the team's server there and
// tests it; on a team song's Audio tab, separating names the team's server. Screenshots go to e2e/.artifacts.
import { chromium } from "playwright";
import { API, SP, WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";
import { startFakeDemucs, toneWav } from "../lib/fake-demucs.mjs";

let page;
const step = stepper(() => page);
const sonic = await startFakeDemucs({ port: 3995, key: "web-team-sonic-key" });
const admin = await user("Sonic web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const leader = await user("Sonic web leader");
await call(admin, "DELETE", "/admin/stem-separation");
const team = (await call(leader, "POST", "/teams", { name: `Grace Band ${stamp}` })).body;
const song = await api(leader, "POST", "/song-versions", { title: `Sonic web ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hi\n", contentFormat: "CHORDPRO", teamId: team.id });
const form = new FormData();
form.append("type", "AUDIO");
form.append("file", new Blob([toneWav(300, 2)], { type: "audio/wav" }), "Full mix.wav");
await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${leader.bearer}` }, body: form });

const browser = await chromium.launch();
try {
  const errors = [];
  const pageFor = async (who) => {
    const one = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    one.on("pageerror", (error) => errors.push(error.message));
    await signIn(one, who);
    return one;
  };
  const leaderPage = await pageFor(leader);
  const adminPage = await pageFor(admin);
  page = leaderPage;

  await step("before Admin allows it, no card on the team's page", async () => {
    page = leaderPage;
    await page.goto(`${WEB}/teams/${team.id}`);
    await page.getByTestId("brands-card").waitFor();
    if (await page.getByTestId("sonic-server-card").count()) throw new Error("the card shows");
  });

  await step("Admin: no server of its own, teams and organisations allowed theirs, on private addresses too", async () => {
    page = adminPage;
    await page.goto(`${WEB}/admin/stem-separation`);
    await page.getByText("Optional: teams and organisations").waitFor();
    await page.getByTestId("stem-own-list").getByText("Connected").waitFor();
    await page.getByTestId("stem-own-servers").check();
    await page.getByTestId("stem-own-private").check();
    await page.getByTestId("stem-save").click();
    for (let i = 0; i < 30; i++) {
      const summary = (await call(admin, "GET", "/admin/stem-separation")).body;
      if (summary.ownServers && summary.ownServersPrivate) break;
      if (i === 29) throw new Error(JSON.stringify(summary));
      await page.waitForTimeout(200);
    }
  });

  await step("the team's admin connects its server and tests it", async () => {
    page = leaderPage;
    await page.goto(`${WEB}/teams/${team.id}`);
    const card = page.getByTestId("sonic-server-card");
    await card.waitFor();
    await card.getByTestId("sonic-api-url").fill(sonic.url);
    await card.getByTestId("sonic-api-key").fill(sonic.key);
    await card.getByTestId("sonic-save").click();
    await card.getByTestId("sonic-server-connected").getByText(sonic.url).waitFor();
    if ((await card.getByTestId("sonic-api-key").inputValue()) !== "") throw new Error("the key is shown again");
    await card.getByTestId("sonic-test").click();
    await card.getByTestId("sonic-test-result").getByText("Connected: songverse-sonic 1.6.0").waitFor();
    await card.screenshot({ path: `${SP}/sonic-server-card.png` });
  });

  await step("separating a team song's recording names the team's server", async () => {
    await page.goto(`${WEB}/library/${song.id}?tab=audio`);
    await page.getByTestId("separate-stems").click();
    await page.getByTestId("separate-server").getByText(`On ${team.name}'s Sonic server`).waitFor();
  });

  await step("Admin lists it, whose it is", async () => {
    page = adminPage;
    await page.goto(`${WEB}/admin/stem-separation`);
    await page.getByTestId("stem-own-list").getByText(team.name).waitFor();
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
  await call(admin, "DELETE", "/admin/stem-separation");
  await sonic.close();
}
finish();
